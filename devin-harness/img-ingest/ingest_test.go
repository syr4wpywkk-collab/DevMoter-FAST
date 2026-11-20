package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 最小の有効な WebP (1x1 透明, VP8L)。golang.org/x/image/webp でデコード可能。
const webp1x1Base64 = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"

func runTool(t *testing.T, stdin string, args ...string) (string, string, int) {
	t.Helper()
	var outBuf, errBuf bytes.Buffer
	code := run(args, strings.NewReader(stdin), &outBuf, &errBuf)
	return outBuf.String(), errBuf.String(), code
}

func makePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	c := color.RGBA{R: 200, G: 40, B: 60, A: 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	return buf.Bytes()
}

func makeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	c := color.RGBA{R: 30, G: 160, B: 90, A: 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatalf("jpeg encode: %v", err)
	}
	return buf.Bytes()
}

func makeGIF(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	c := color.RGBA{R: 20, G: 60, B: 220, A: 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := gif.Encode(&buf, img, nil); err != nil {
		t.Fatalf("gif encode: %v", err)
	}
	return buf.Bytes()
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func parseOK(t *testing.T, line string) successResult {
	t.Helper()
	var res successResult
	if err := json.Unmarshal([]byte(line), &res); err != nil {
		t.Fatalf("unmarshal result %q: %v", line, err)
	}
	if !res.OK {
		t.Fatalf("expected ok=true, got %s", line)
	}
	return res
}

func firstLine(s string) string {
	s = strings.TrimRight(s, "\n")
	if i := strings.Index(s, "\n"); i >= 0 {
		return s[:i]
	}
	return s
}

func TestPNGWithDataURI(t *testing.T) {
	dir := t.TempDir()
	raw := makePNG(t, 16, 12)
	in := "data:image/png;base64," + b64(raw)
	stdout, _, code := runTool(t, in, "--out-dir", dir)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0 (stdout=%s)", code, stdout)
	}
	res := parseOK(t, firstLine(stdout))
	if res.MIME != "image/png" {
		t.Errorf("mime = %s, want image/png", res.MIME)
	}
	if res.Width != 16 || res.Height != 12 {
		t.Errorf("dims = %dx%d, want 16x12", res.Width, res.Height)
	}
	if !filepath.IsAbs(res.Path) {
		t.Errorf("path is not absolute: %s", res.Path)
	}
	st, err := os.Stat(res.Path)
	if err != nil {
		t.Fatalf("output file missing: %v", err)
	}
	if st.Size() != res.Bytes {
		t.Errorf("file size %d != reported bytes %d", st.Size(), res.Bytes)
	}
	if st.Mode().Perm() != 0o600 {
		t.Errorf("file perm = %o, want 600", st.Mode().Perm())
	}
	if len(res.SHA256) != 64 {
		t.Errorf("sha256 len = %d, want 64", len(res.SHA256))
	}
	if !strings.HasSuffix(res.Path, ".png") {
		t.Errorf("path suffix: %s", res.Path)
	}
}

func TestJPEGExifStripped(t *testing.T) {
	dir := t.TempDir()
	base := makeJPEG(t, 20, 20)
	// SOI (FF D8) の直後に APP1 "Exif\0\0..." セグメントを注入する。
	payload := append([]byte("Exif\x00\x00"), []byte{0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00}...)
	seg := make([]byte, 0, 4+len(payload))
	seg = append(seg, 0xFF, 0xE1)
	var lb [2]byte
	binary.BigEndian.PutUint16(lb[:], uint16(len(payload)+2))
	seg = append(seg, lb[:]...)
	seg = append(seg, payload...)
	withExif := make([]byte, 0, len(base)+len(seg))
	withExif = append(withExif, base[:2]...)
	withExif = append(withExif, seg...)
	withExif = append(withExif, base[2:]...)
	if !bytes.Contains(withExif, []byte("Exif")) {
		t.Fatal("test fixture does not contain Exif marker")
	}

	stdout, _, code := runTool(t, b64(withExif), "--out-dir", dir)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	res := parseOK(t, firstLine(stdout))
	if res.MIME != "image/jpeg" {
		t.Errorf("mime = %s, want image/jpeg", res.MIME)
	}
	out, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if bytes.Contains(out, []byte("Exif")) {
		t.Errorf("output still contains Exif metadata")
	}
	if _, format, err := image.DecodeConfig(bytes.NewReader(out)); err != nil || format != "jpeg" {
		t.Errorf("output decode config: format=%s err=%v", format, err)
	}
}

func TestGIFRoundTrip(t *testing.T) {
	dir := t.TempDir()
	raw := makeGIF(t, 14, 9)
	stdout, _, code := runTool(t, b64(raw), "--out-dir", dir)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	res := parseOK(t, firstLine(stdout))
	if res.MIME != "image/gif" || !strings.HasSuffix(res.Path, ".gif") {
		t.Errorf("mime/path = %s / %s, want image/gif + .gif", res.MIME, res.Path)
	}
	if res.Width != 14 || res.Height != 9 {
		t.Errorf("dims = %dx%d, want 14x9", res.Width, res.Height)
	}
}

func TestWebPConvertedToPNG(t *testing.T) {
	dir := t.TempDir()
	stdout, _, code := runTool(t, webp1x1Base64, "--out-dir", dir)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	res := parseOK(t, firstLine(stdout))
	// 仕様適応: WebP エンコーダが無いため PNG 出力になる。
	if res.MIME != "image/png" || !strings.HasSuffix(res.Path, ".png") {
		t.Errorf("mime/path = %s / %s, want image/png + .png", res.MIME, res.Path)
	}
	if res.Width != 1 || res.Height != 1 {
		t.Errorf("dims = %dx%d, want 1x1", res.Width, res.Height)
	}
	out, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if _, format, err := image.DecodeConfig(bytes.NewReader(out)); err != nil || format != "png" {
		t.Errorf("output format = %s err=%v, want png", format, err)
	}
}

func TestJSONLMultiple(t *testing.T) {
	dir := t.TempDir()
	pngB := b64(makePNG(t, 10, 10))
	jpgB := b64(makeJPEG(t, 11, 7))
	lines := []string{
		`{"id":"a1","base64":"` + pngB + `","label":"first"}`,
		`{"id":42,"base64":"` + jpgB + `"}`,
		`{"base64":"` + pngB + `"}`,
	}
	stdout, _, code := runTool(t, strings.Join(lines, "\n")+"\n", "--out-dir", dir)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0 (stdout=%s)", code, stdout)
	}
	outLines := strings.Split(strings.TrimRight(stdout, "\n"), "\n")
	if len(outLines) != 3 {
		t.Fatalf("output lines = %d, want 3: %q", len(outLines), stdout)
	}
	r0 := parseOK(t, outLines[0])
	if string(r0.ID) != `"a1"` {
		t.Errorf("line0 id = %s, want \"a1\"", r0.ID)
	}
	r1 := parseOK(t, outLines[1])
	if string(r1.ID) != `42` {
		t.Errorf("line1 id = %s, want 42", r1.ID)
	}
	if r1.MIME != "image/jpeg" {
		t.Errorf("line1 mime = %s, want image/jpeg", r1.MIME)
	}
	r2 := parseOK(t, outLines[2])
	if len(r2.ID) != 0 {
		t.Errorf("line2 id = %s, want absent", r2.ID)
	}
	// PNG は2回投入されたがデデュプで同一 path。
	if r0.Path != r2.Path {
		t.Errorf("dedup in JSONL: %s != %s", r0.Path, r2.Path)
	}
}

func TestJSONLPartialFailure(t *testing.T) {
	dir := t.TempDir()
	good := `{"id":"good","base64":"` + b64(makePNG(t, 8, 8)) + `"}`
	bad := `{"id":"bad","base64":"%%%broken%%%"}`
	stdout, _, code := runTool(t, good+"\n"+bad+"\n", "--out-dir", dir)
	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero on partial failure")
	}
	outLines := strings.Split(strings.TrimRight(stdout, "\n"), "\n")
	if len(outLines) != 2 {
		t.Fatalf("output lines = %d, want 2: %q", len(outLines), stdout)
	}
	parseOK(t, outLines[0])
	var er errorResult
	if err := json.Unmarshal([]byte(outLines[1]), &er); err != nil {
		t.Fatalf("unmarshal error line: %v", err)
	}
	if er.OK || er.Error == "" || string(er.ID) != `"bad"` {
		t.Errorf("error line = %+v, want ok=false with id=bad and error set", er)
	}
}

func TestMaxBytesExceeded(t *testing.T) {
	dir := t.TempDir()
	raw := makePNG(t, 32, 32)
	stdout, stderr, code := runTool(t, b64(raw), "--out-dir", dir, "--max-bytes", "32")
	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero (stdout=%s)", stdout)
	}
	if strings.TrimSpace(stdout) != "" {
		t.Errorf("stdout should be empty on single-mode failure, got %q", stdout)
	}
	if !strings.Contains(stderr, `"ok":false`) {
		t.Errorf("stderr should carry structured error, got %q", stderr)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("out-dir should have no files, got %d", len(entries))
	}
}

func TestResizeLongSide(t *testing.T) {
	dir := t.TempDir()
	raw := makePNG(t, 4000, 100)
	stdout, _, code := runTool(t, b64(raw), "--out-dir", dir, "--max-dim", "1000")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	res := parseOK(t, firstLine(stdout))
	if res.Width != 1000 || res.Height != 25 {
		t.Errorf("dims = %dx%d, want 1000x25", res.Width, res.Height)
	}
	out, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode output config: %v", err)
	}
	if cfg.Width != 1000 || cfg.Height != 25 {
		t.Errorf("stored dims = %dx%d, want 1000x25", cfg.Width, cfg.Height)
	}
}

func TestDedupSameImageTwice(t *testing.T) {
	dir := t.TempDir()
	in := b64(makePNG(t, 12, 12))
	out1, _, code1 := runTool(t, in, "--out-dir", dir)
	out2, _, code2 := runTool(t, in, "--out-dir", dir)
	if code1 != 0 || code2 != 0 {
		t.Fatalf("codes = %d, %d; want 0, 0", code1, code2)
	}
	r1 := parseOK(t, firstLine(out1))
	r2 := parseOK(t, firstLine(out2))
	if r1.Path != r2.Path {
		t.Errorf("paths differ: %s vs %s", r1.Path, r2.Path)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("files in out-dir = %d, want 1", len(entries))
	}
}

func TestCorruptBase64(t *testing.T) {
	dir := t.TempDir()
	_, stderr, code := runTool(t, "!!!not-base64!!!", "--out-dir", dir)
	if code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr, `"ok":false`) {
		t.Errorf("stderr = %q, want structured error", stderr)
	}
}

func TestSVGRejected(t *testing.T) {
	dir := t.TempDir()
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`
	_, _, code := runTool(t, b64([]byte(svg)), "--out-dir", dir)
	if code == 0 {
		t.Fatal("exit code = 0, want non-zero for SVG input")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("out-dir should have no files, got %d", len(entries))
	}
}

func TestEmptyInput(t *testing.T) {
	dir := t.TempDir()
	for _, in := range []string{"", "   \n\t  "} {
		if _, _, code := runTool(t, in, "--out-dir", dir); code == 0 {
			t.Errorf("input %q: exit code = 0, want non-zero", in)
		}
	}
}

// craftBombPNG は IHDR だけ巨大寸法を主張する小さな PNG を作る。
func craftBombPNG(w, h uint32) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})
	writeChunk := func(typ string, data []byte) {
		var lb [4]byte
		binary.BigEndian.PutUint32(lb[:], uint32(len(data)))
		buf.Write(lb[:])
		buf.WriteString(typ)
		buf.Write(data)
		crcData := append([]byte(typ), data...)
		var cb [4]byte
		binary.BigEndian.PutUint32(cb[:], crc32.ChecksumIEEE(crcData))
		buf.Write(cb[:])
	}
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], w)
	binary.BigEndian.PutUint32(ihdr[4:8], h)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // color type: RGB
	writeChunk("IHDR", ihdr)
	writeChunk("IEND", nil)
	return buf.Bytes()
}

func TestPixelBombRejected(t *testing.T) {
	dir := t.TempDir()
	bomb := craftBombPNG(20000, 20000) // 4億ピクセル > 1億上限
	_, stderr, code := runTool(t, b64(bomb), "--out-dir", dir)
	if code == 0 {
		t.Fatal("exit code = 0, want non-zero for pixel bomb")
	}
	if !strings.Contains(stderr, "pixel") {
		t.Errorf("stderr = %q, want pixel-limit error", stderr)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("out-dir should have no files, got %d", len(entries))
	}
}

func TestOutDirRequired(t *testing.T) {
	if _, _, code := runTool(t, b64(makePNG(t, 4, 4))); code == 0 {
		t.Fatal("exit code = 0, want non-zero when --out-dir missing")
	}
}

func TestRawBase64WithoutPadding(t *testing.T) {
	dir := t.TempDir()
	raw := makePNG(t, 9, 9)
	enc := base64.RawStdEncoding.EncodeToString(raw)
	stdout, _, code := runTool(t, enc, "--out-dir", dir)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0 for unpadded base64", code)
	}
	res := parseOK(t, firstLine(stdout))
	if res.Width != 9 || res.Height != 9 {
		t.Errorf("dims = %dx%d, want 9x9", res.Width, res.Height)
	}
}
