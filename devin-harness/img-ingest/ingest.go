// img-ingest: stdin から Base64 画像を受け取り、検証・サニタイズ・リサイズして
// out-dir にアトミック配置し、結果を JSON で stdout に返す単一バイナリ (SPEC §5.1)。
//
// 仕様適応 (README 的メモ):
//   - WebP は golang.org/x/image/webp にデコーダしか無く、標準ライブラリにも
//     WebP エンコーダが存在しない。そのため WebP 入力は再エンコード時に PNG へ
//     変換して出力する (mime は image/png、拡張子は .png になる)。
//   - サニタイズは「デコード → 再エンコード」で行い、EXIF 等のメタデータは
//     Go のデコーダが保持しないため自動的に除去される。
//   - ログ/エラーに Base64 生データは決して含めない。
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color/palette"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // WebP デコーダ登録用
)

// maxPixels はピクセル爆弾ガードの上限 (width*height)。DecodeConfig 時点で判定する。
const maxPixels = 100_000_000

type config struct {
	outDir   string // 絶対パス
	maxBytes int64  // Base64 デコード後のバイト上限
	maxDim   int    // 長辺上限
}

type successResult struct {
	OK     bool            `json:"ok"`
	ID     json.RawMessage `json:"id,omitempty"`
	Path   string          `json:"path"`
	MIME   string          `json:"mime"`
	Width  int             `json:"width"`
	Height int             `json:"height"`
	Bytes  int64           `json:"bytes"`
	SHA256 string          `json:"sha256"`
}

type errorResult struct {
	OK    bool            `json:"ok"`
	ID    json.RawMessage `json:"id,omitempty"`
	Error string          `json:"error"`
}

func writeJSONLine(w io.Writer, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	w.Write(b)
	io.WriteString(w, "\n")
}

func emitError(w io.Writer, id json.RawMessage, msg string) {
	writeJSONLine(w, errorResult{OK: false, ID: id, Error: msg})
}

// run はテストから直接呼べるエントリポイント。終了コードを返す。
func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("img-ingest", flag.ContinueOnError)
	fs.SetOutput(stderr)
	outDir := fs.String("out-dir", "", "output directory (required)")
	maxBytes := fs.Int64("max-bytes", 20971520, "max size of base64-decoded image bytes")
	maxDim := fs.Int("max-dim", 2048, "max length of the longest side in pixels")
	maxInput := fs.Int64("max-input-bytes", -1, "max raw stdin bytes (default: 3 * max-bytes)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() > 0 {
		emitError(stderr, nil, "unexpected positional arguments (input is stdin only)")
		return 2
	}
	if *outDir == "" {
		emitError(stderr, nil, "--out-dir is required")
		return 2
	}
	if *maxBytes <= 0 {
		emitError(stderr, nil, "--max-bytes must be positive")
		return 2
	}
	if *maxDim <= 0 {
		emitError(stderr, nil, "--max-dim must be positive")
		return 2
	}
	inputLimit := *maxInput
	if inputLimit < 0 {
		inputLimit = *maxBytes * 3
	}
	if inputLimit <= 0 {
		emitError(stderr, nil, "--max-input-bytes must be positive")
		return 2
	}

	absOut, err := filepath.Abs(*outDir)
	if err != nil {
		emitError(stderr, nil, fmt.Sprintf("resolve out-dir: %v", err))
		return 1
	}
	if err := os.MkdirAll(absOut, 0o700); err != nil {
		emitError(stderr, nil, fmt.Sprintf("create out-dir: %v", err))
		return 1
	}
	// 既存ディレクトリにも仕様の 0700 を保証する。
	_ = os.Chmod(absOut, 0o700)

	raw, err := io.ReadAll(io.LimitReader(stdin, inputLimit+1))
	if err != nil {
		emitError(stderr, nil, fmt.Sprintf("read stdin: %v", err))
		return 1
	}
	if int64(len(raw)) > inputLimit {
		emitError(stderr, nil, fmt.Sprintf("input exceeds --max-input-bytes (%d bytes)", inputLimit))
		return 1
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		emitError(stderr, nil, "empty input")
		return 1
	}

	cfg := config{outDir: absOut, maxBytes: *maxBytes, maxDim: *maxDim}

	// 入力判定: 最初の非空白文字が '{' なら JSONL モード、それ以外は単一 Base64。
	if trimmed[0] == '{' {
		return runJSONL(cfg, raw, stdout, stderr)
	}

	res, err := processOne(cfg, nil, string(raw))
	if err != nil {
		emitError(stderr, nil, err.Error())
		return 1
	}
	writeJSONLine(stdout, res)
	return 0
}

type jsonlEntry struct {
	ID     json.RawMessage `json:"id"`
	Base64 string          `json:"base64"`
	Label  string          `json:"label"`
}

func runJSONL(cfg config, raw []byte, stdout, stderr io.Writer) int {
	anyFail := false
	lines := bytes.Split(raw, []byte("\n"))
	for _, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var entry jsonlEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			emitError(stdout, nil, fmt.Sprintf("invalid JSON line: %v", err))
			emitError(stderr, nil, fmt.Sprintf("invalid JSON line: %v", err))
			anyFail = true
			continue
		}
		if strings.TrimSpace(entry.Base64) == "" {
			emitError(stdout, entry.ID, "missing base64 field")
			emitError(stderr, entry.ID, "missing base64 field")
			anyFail = true
			continue
		}
		res, err := processOne(cfg, entry.ID, entry.Base64)
		if err != nil {
			emitError(stdout, entry.ID, err.Error())
			emitError(stderr, entry.ID, err.Error())
			anyFail = true
			continue
		}
		writeJSONLine(stdout, res)
	}
	if anyFail {
		return 1
	}
	return 0
}

// decodeBase64 は StdEncoding を試し、パディング不足なら RawStdEncoding も試す。
// 不正文字・パディング崩れはどちらでも失敗しエラーになる。
func decodeBase64(s string) ([]byte, error) {
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	b, err := base64.RawStdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 data")
	}
	return b, nil
}

// cleanBase64 は data URI プレフィックスを除去し、全空白を取り除く。
func cleanBase64(s string) (string, error) {
	s = strings.TrimSpace(s)
	if len(s) >= 5 && strings.EqualFold(s[:5], "data:") {
		idx := strings.Index(s, ",")
		if idx < 0 {
			return "", fmt.Errorf("malformed data URI (missing comma)")
		}
		s = s[idx+1:]
	}
	s = strings.Join(strings.Fields(s), "")
	if s == "" {
		return "", fmt.Errorf("empty base64 payload")
	}
	return s, nil
}

// sniffFormat はマジックバイトで形式を判定する。許可形式以外は拒否。
func sniffFormat(b []byte) (string, error) {
	switch {
	case bytes.HasPrefix(b, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}):
		return "png", nil
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return "jpeg", nil
	case bytes.HasPrefix(b, []byte("GIF87a")) || bytes.HasPrefix(b, []byte("GIF89a")):
		return "gif", nil
	case len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "webp", nil
	default:
		return "", fmt.Errorf("unsupported image format (only PNG, JPEG, GIF, WebP are allowed)")
	}
}

// scaledDims は長辺が maxDim を超える場合の縮小後寸法を返す (resized=false なら不要)。
func scaledDims(w, h, maxDim int) (nw, nh int, resized bool) {
	m := w
	if h > m {
		m = h
	}
	if m <= maxDim {
		return w, h, false
	}
	if w >= h {
		nw = maxDim
		nh = h * maxDim / w
	} else {
		nh = maxDim
		nw = w * maxDim / h
	}
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	return nw, nh, true
}

func resizeImage(src image.Image, nw, nh int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
	return dst
}

// transform はデコード済み画像を再エンコード (サニタイズ) し、必要ならリサイズする。
// 戻り値は最終バイト列・出力形式 ("png"/"jpeg"/"gif")・最終寸法。
func (cfg config) transform(raw []byte, format string) ([]byte, string, int, int, error) {
	if format == "gif" {
		return cfg.transformGIF(raw)
	}

	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", 0, 0, fmt.Errorf("decode image: %v", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if nw, nh, resized := scaledDims(w, h, cfg.maxDim); resized {
		img = resizeImage(img, nw, nh)
		w, h = nw, nh
	}

	var buf bytes.Buffer
	outFormat := format
	switch format {
	case "jpeg":
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
			return nil, "", 0, 0, fmt.Errorf("encode jpeg: %v", err)
		}
	case "png", "webp":
		// WebP はエンコーダが無いため PNG に変換して出力する (仕様適応)。
		if err := png.Encode(&buf, img); err != nil {
			return nil, "", 0, 0, fmt.Errorf("encode png: %v", err)
		}
		outFormat = "png"
	default:
		return nil, "", 0, 0, fmt.Errorf("unsupported format %q", format)
	}
	return buf.Bytes(), outFormat, w, h, nil
}

func (cfg config) transformGIF(raw []byte) ([]byte, string, int, int, error) {
	g, err := gif.DecodeAll(bytes.NewReader(raw))
	if err != nil || len(g.Image) == 0 {
		// フォールバック: 単一フレームとして通常デコード。
		img, _, derr := image.Decode(bytes.NewReader(raw))
		if derr != nil {
			return nil, "", 0, 0, fmt.Errorf("decode gif: %v", err)
		}
		b := img.Bounds()
		w, h := b.Dx(), b.Dy()
		if nw, nh, resized := scaledDims(w, h, cfg.maxDim); resized {
			img = resizeImage(img, nw, nh)
			w, h = nw, nh
		}
		var buf bytes.Buffer
		if err := gif.Encode(&buf, img, nil); err != nil {
			return nil, "", 0, 0, fmt.Errorf("encode gif: %v", err)
		}
		return buf.Bytes(), "gif", w, h, nil
	}

	cw, ch := g.Config.Width, g.Config.Height
	if cw <= 0 || ch <= 0 {
		fb := g.Image[0].Bounds()
		cw, ch = fb.Dx(), fb.Dy()
	}

	if len(g.Image) == 1 {
		img := g.Image[0]
		w, h := cw, ch
		var out image.Image = img
		if nw, nh, resized := scaledDims(w, h, cfg.maxDim); resized {
			out = resizeImage(img, nw, nh)
			w, h = nw, nh
		}
		var buf bytes.Buffer
		if err := gif.Encode(&buf, out, nil); err != nil {
			return nil, "", 0, 0, fmt.Errorf("encode gif: %v", err)
		}
		return buf.Bytes(), "gif", w, h, nil
	}

	// アニメーション GIF: フレーム保持を試みる。
	ncw, nch, resized := scaledDims(cw, ch, cfg.maxDim)
	outGIF := &gif.GIF{
		LoopCount:       g.LoopCount,
		Delay:           g.Delay,
		Disposal:        g.Disposal,
		BackgroundIndex: g.BackgroundIndex,
		Config:          g.Config,
	}
	outGIF.Config.Width = ncw
	outGIF.Config.Height = nch
	if !resized {
		outGIF.Image = g.Image
	} else {
		ratio := float64(ncw) / float64(cw)
		frames := make([]*image.Paletted, 0, len(g.Image))
		for _, frame := range g.Image {
			fb := frame.Bounds()
			fw := max(1, int(float64(fb.Dx())*ratio+0.5))
			fh := max(1, int(float64(fb.Dy())*ratio+0.5))
			nx := int(float64(fb.Min.X) * ratio)
			ny := int(float64(fb.Min.Y) * ratio)
			resizedFrame := resizeImage(frame, fw, fh)
			pal := frame.Palette
			if pal == nil {
				pal = palette.Plan9
			}
			np := image.NewPaletted(image.Rect(nx, ny, nx+fw, ny+fh), pal)
			draw.FloydSteinberg.Draw(np, np.Bounds(), resizedFrame, image.Point{})
			frames = append(frames, np)
		}
		outGIF.Image = frames
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, outGIF); err != nil {
		return nil, "", 0, 0, fmt.Errorf("encode gif: %v", err)
	}
	return buf.Bytes(), "gif", ncw, nch, nil
}

func mimeAndExt(format string) (string, string) {
	switch format {
	case "jpeg":
		return "image/jpeg", ".jpg"
	case "gif":
		return "image/gif", ".gif"
	default: // png (WebP 入力も PNG 出力)
		return "image/png", ".png"
	}
}

func syncDir(dir string) {
	if f, err := os.Open(dir); err == nil {
		_ = f.Sync()
		f.Close()
	}
}

// writeAtomic は一時ファイル → fsync → rename でアトミックに配置する (権限 0600)。
func writeAtomic(dir, name string, data []byte) (string, error) {
	path := filepath.Join(dir, name)
	tmp, err := os.CreateTemp(dir, ".img-tmp-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return "", err
	}
	syncDir(dir)
	return path, nil
}

// processOne は 1 件分の検証・変換・配置を行い、成功結果を返す。
func processOne(cfg config, id json.RawMessage, input string) (*successResult, error) {
	cleaned, err := cleanBase64(input)
	if err != nil {
		return nil, err
	}
	raw, err := decodeBase64(cleaned)
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > cfg.maxBytes {
		return nil, fmt.Errorf("decoded size %d exceeds --max-bytes %d", len(raw), cfg.maxBytes)
	}
	format, err := sniffFormat(raw)
	if err != nil {
		return nil, err
	}
	// ピクセル爆弾ガード: フルデコード前に寸法だけ読んで判定する。
	imgCfg, decodedFormat, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("cannot read image config: %v", err)
	}
	if decodedFormat != format {
		return nil, fmt.Errorf("image format mismatch (magic=%s, decoder=%s)", format, decodedFormat)
	}
	if imgCfg.Width <= 0 || imgCfg.Height <= 0 {
		return nil, fmt.Errorf("invalid image dimensions %dx%d", imgCfg.Width, imgCfg.Height)
	}
	if int64(imgCfg.Width)*int64(imgCfg.Height) > maxPixels {
		return nil, fmt.Errorf("image dimensions %dx%d exceed pixel limit %d", imgCfg.Width, imgCfg.Height, maxPixels)
	}

	outBytes, outFormat, w, h, err := cfg.transform(raw, format)
	if err != nil {
		return nil, err
	}

	sum := sha256.Sum256(outBytes)
	fullHex := hex.EncodeToString(sum[:])
	mime, ext := mimeAndExt(outFormat)
	name := "img_" + fullHex[:16] + ext
	path := filepath.Join(cfg.outDir, name)

	// デデュプ: 同内容 (同一ハッシュ名・同一サイズ) が既存なら再書き込みしない。
	if st, err := os.Stat(path); err == nil && st.Mode().IsRegular() && st.Size() == int64(len(outBytes)) {
		// そのまま既存 path を返す。
	} else {
		p, err := writeAtomic(cfg.outDir, name, outBytes)
		if err != nil {
			return nil, fmt.Errorf("write output: %v", err)
		}
		path = p
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		absPath = path
	}
	return &successResult{
		OK:     true,
		ID:     id,
		Path:   absPath,
		MIME:   mime,
		Width:  w,
		Height: h,
		Bytes:  int64(len(outBytes)),
		SHA256: fullHex,
	}, nil
}
