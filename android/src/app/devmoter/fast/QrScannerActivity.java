package app.devmoter.fast;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Camera;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

@SuppressWarnings("deprecation")
public final class QrScannerActivity extends Activity implements SurfaceHolder.Callback {
    private Camera camera;
    private SurfaceHolder surface;
    private boolean resumed;
    private boolean ready;
    private boolean done;
    private long lastFrame;
    private final AtomicBoolean decoding = new AtomicBoolean();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView hint;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setFitsSystemWindows(true);
        hint = new TextView(this);
        hint.setText("DevMoterの接続QRコードを枠内に映してください。");
        hint.setPadding(24,24,24,24);
        root.addView(hint);
        SurfaceView preview = new SurfaceView(this);
        surface = preview.getHolder(); surface.addCallback(this);
        root.addView(preview, new LinearLayout.LayoutParams(-1, 0, 1));
        Button close = new Button(this); close.setText("閉じる");
        close.setOnClickListener(v -> finish()); root.addView(close);
        setContentView(root);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == 1 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) startCamera();
        else hint.setText("カメラ権限がありません。接続リンクを手入力してください。");
    }
    @Override protected void onResume() { super.onResume(); resumed = true; startCamera(); }
    @Override protected void onPause() { resumed = false; stopCamera(); super.onPause(); }
    @Override protected void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
    @Override public void surfaceCreated(SurfaceHolder h) { ready = true; startCamera(); }
    @Override public void surfaceChanged(SurfaceHolder h, int format, int width, int height) { }
    @Override public void surfaceDestroyed(SurfaceHolder h) { ready = false; stopCamera(); }

    private void startCamera() {
        if (!resumed || !ready || done || camera != null || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        try {
            Camera.CameraInfo info = new Camera.CameraInfo();
            int id = -1;
            for (int i = 0; i < Camera.getNumberOfCameras(); i++) {
                Camera.getCameraInfo(i, info);
                if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) { id = i; break; }
            }
            if (id < 0) { hint.setText("背面カメラがありません。接続リンクを手入力してください。"); return; }
            camera = Camera.open(id);
            Camera.Parameters params = camera.getParameters();
            if (params.getSupportedFocusModes() != null &&
                params.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            java.util.List<Camera.Size> sizes = params.getSupportedPreviewSizes();
            Camera.Size best = params.getPreviewSize();
            if (sizes != null) for (Camera.Size size : sizes) {
                if (Math.abs((long)size.width * size.height - 640L * 480L) <
                    Math.abs((long)best.width * best.height - 640L * 480L)) best = size;
            }
            params.setPreviewSize(best.width, best.height);
            params.setPreviewFormat(android.graphics.ImageFormat.NV21);
            camera.setParameters(params);
            Camera.Size size = camera.getParameters().getPreviewSize();
            camera.setDisplayOrientation(info.orientation);
            camera.setPreviewDisplay(surface);
            camera.setPreviewCallback((data, c) -> decodeFrame(data, size.width, size.height));
            camera.startPreview();
        } catch (Exception e) { stopCamera(); hint.setText("カメラを開始できません。接続リンクを手入力してください。"); }
    }

    private void decodeFrame(byte[] data, int width, int height) {
        long now = SystemClock.elapsedRealtime();
        if (done || !resumed || data == null || data.length < (long)width * height ||
            now - lastFrame < 300 || !decoding.compareAndSet(false, true)) return;
        lastFrame = now;
        byte[] frame = java.util.Arrays.copyOf(data, width * height);
        executor.execute(() -> {
            try {
                PlanarYUVLuminanceSource image = new PlanarYUVLuminanceSource(frame, width, height, 0, 0, width, height, false);
                String value = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(image))).getText();
                String link = MainActivity.pairingLink(value);
                runOnUiThread(() -> {
                    if (done || !resumed || isFinishing()) return;
                    if (link == null) { hint.setText("DevMoterの接続QRではありません。"); return; }
                    done = true; stopCamera();
                    setResult(RESULT_OK, new Intent().putExtra("pairing", link)); finish();
                });
            } catch (Exception ignored) { }
            finally { java.util.Arrays.fill(frame, (byte)0); decoding.set(false); }
        });
    }

    private void stopCamera() {
        Camera old = camera; camera = null;
        if (old != null) {
            try { old.setPreviewCallback(null); old.stopPreview(); } catch (RuntimeException ignored) { }
            old.release();
        }
    }
}
