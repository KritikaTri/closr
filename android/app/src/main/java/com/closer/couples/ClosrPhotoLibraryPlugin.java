package com.closer.couples;

import android.Manifest;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "ClosrPhotoLibrary", permissions = {
    @Permission(alias = "legacy", strings = {Manifest.permission.READ_EXTERNAL_STORAGE}),
    @Permission(alias = "photos", strings = {Manifest.permission.READ_MEDIA_IMAGES}),
    @Permission(alias = "selected", strings = {Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED})
})
public class ClosrPhotoLibraryPlugin extends Plugin {
    private final Set<String> allowedIds = new HashSet<>();
    private boolean granted(String permission) { return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED; }
    private boolean canRead() {
        return Build.VERSION.SDK_INT >= 34 ? granted(Manifest.permission.READ_MEDIA_IMAGES) || granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            : Build.VERSION.SDK_INT >= 33 ? granted(Manifest.permission.READ_MEDIA_IMAGES) : granted(Manifest.permission.READ_EXTERNAL_STORAGE);
    }
    @PluginMethod public void preview(PluginCall call) {
        if (canRead()) { loadPreview(call); return; }
        if (Build.VERSION.SDK_INT >= 34) requestPermissionForAliases(new String[]{"photos", "selected"}, call, "permissionResult");
        else requestPermissionForAlias(Build.VERSION.SDK_INT >= 33 ? "photos" : "legacy", call, "permissionResult");
    }
    @PermissionCallback private void permissionResult(PluginCall call) {
        if (canRead()) loadPreview(call);
        else call.reject("Photo access wasn’t allowed. You can still use Choose photos.");
    }
    private void loadPreview(PluginCall call) {
        bridge.execute(() -> {
            try {
                LocalDate from = LocalDate.parse(call.getString("from", ""));
                LocalDate to = LocalDate.parse(call.getString("to", ""));
                if (to.isBefore(from) || java.time.temporal.ChronoUnit.DAYS.between(from, to) > 366) throw new IllegalArgumentException();
                boolean favourites = call.getBoolean("favouritesOnly", false);
                if (favourites && Build.VERSION.SDK_INT < 30) { call.reject("Favourites filtering needs Android 11 or newer. Use your phone’s photo picker instead."); return; }
                ZoneId zone = ZoneId.systemDefault();
                long start = from.atStartOfDay(zone).toInstant().toEpochMilli(), end = to.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
                String[] projection = Build.VERSION.SDK_INT >= 30
                    ? new String[]{"_id", "datetaken", "date_added", "width", "height", "is_favorite"}
                    : new String[]{"_id", "datetaken", "date_added", "width", "height"};
                String where = "((datetaken >= ? AND datetaken < ?) OR ((datetaken IS NULL OR datetaken = 0) AND date_added >= ? AND date_added < ?))" + (favourites ? " AND is_favorite = 1" : "");
                JSArray items = new JSArray(); boolean hasMore = false;
                synchronized (allowedIds) { allowedIds.clear(); }
                try (Cursor cursor = getContext().getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, where, new String[]{String.valueOf(start), String.valueOf(end), String.valueOf(start/1000), String.valueOf(end/1000)}, "datetaken ASC")) {
                    while (cursor != null && cursor.moveToNext()) {
                        if (items.length() == 120) { hasMore = true; break; }
                        String id = cursor.getString(0); Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id));
                        synchronized (allowedIds) { allowedIds.add(id); }
                        long taken = cursor.getLong(1);
                        JSObject item = new JSObject(); item.put("id", id); item.put("date", taken > 0 ? java.time.Instant.ofEpochMilli(taken).atZone(zone).toLocalDate().toString() : null);
                        item.put("width", cursor.getInt(3)); item.put("height", cursor.getInt(4)); item.put("favourite", Build.VERSION.SDK_INT >= 30 && cursor.getInt(5) == 1);
                        try {
                            Bitmap thumb = Build.VERSION.SDK_INT >= 29 ? getContext().getContentResolver().loadThumbnail(uri, new Size(160,160), null) : bitmap(uri, 160);
                            item.put("thumbnail", dataUrl(thumb, 60)); thumb.recycle();
                        } catch (Exception ignored) { /* An unavailable thumbnail must not hide a permitted photo. */ }
                        items.put(item);
                    }
                }
                JSObject result = new JSObject(); result.put("items", items); result.put("hasMore", hasMore);
                result.put("limited", Build.VERSION.SDK_INT >= 34 && !granted(Manifest.permission.READ_MEDIA_IMAGES)); call.resolve(result);
            } catch (Exception error) { call.reject("Couldn’t preview this date range. Check photo access or use Choose photos."); }
        });
    }
    private String dataUrl(Bitmap bitmap, int quality) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, quality, bytes);
        return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }
    private Bitmap bitmap(Uri uri, int size) throws Exception {
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(stream, null, options); }
        options.inSampleSize = 1; while (options.outWidth/options.inSampleSize > size || options.outHeight/options.inSampleSize > size) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false; Bitmap image;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) { image = BitmapFactory.decodeStream(stream, null, options); }
        if (image == null) throw new IllegalArgumentException();
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
            int orientation = new ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            Matrix matrix = new Matrix();
            switch (orientation) {
                case 2: matrix.setScale(-1,1); break;
                case 3: matrix.setRotate(180); break;
                case 4: matrix.setScale(1,-1); break;
                case 5: matrix.setRotate(90); matrix.postScale(-1,1); break;
                case 6: matrix.setRotate(90); break;
                case 7: matrix.setRotate(-90); matrix.postScale(-1,1); break;
                case 8: matrix.setRotate(-90); break;
                default: break;
            }
            if (!matrix.isIdentity()) { Bitmap rotated = Bitmap.createBitmap(image,0,0,image.getWidth(),image.getHeight(),matrix,true); if (rotated != image) image.recycle(); image = rotated; }
        } catch (Exception ignored) { }
        return image;
    }
    @PluginMethod public void read(PluginCall call) {
        String id = call.getString("id", "");
        synchronized (allowedIds) { if (!allowedIds.contains(id)) { call.reject("Choose a photo from the current preview."); return; } }
        bridge.execute(() -> { try {
            if (!canRead()) { call.reject("Photo access has changed. Preview your selection again."); return; }
            Bitmap image = bitmap(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id)), 1400);
            JSObject result = new JSObject(); result.put("dataUrl", dataUrl(image,78)); image.recycle(); call.resolve(result);
        } catch (Exception error) { call.reject("This photo could not be loaded. Preview your selection again or use Choose photos."); } });
    }
}
