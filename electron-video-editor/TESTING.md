# Testing Video Playback

## To Test Video Playback:

1. **Restart the app completely** (kill the process and run again):
   ```bash
   npm run electron:dev
   ```

2. **Load some test videos**:
   - Click "Browse" for Clip Directory
   - Select a folder with MP4 files
   - Click "Browse" for Output Directory
   - Select/create an output folder

3. **Concatenate videos**:
   - Click "Concatenate Videos"
   - Wait for completion

4. **Check the console output** in the Electron DevTools:
   - Look for messages like:
     ```
     Media protocol request: media://...
     Resolved file path: /Users/chris/...
     ```
   - If you see "File not found", the path is incorrect

5. **Verify video plays**:
   - The video should appear in the right panel
   - Controls should work (play, pause, seek)
   - Time display should update as video plays

## Debugging Tips:

### If video doesn't load:
1. **Check the browser console** (DevTools) for errors
2. **Look at the Electron console** for protocol messages
3. **Verify the file path** in console logs is correct
4. **Try a different video format** (MP4 with H.264 works best)

### Expected Console Output:
When video loads successfully, you should see:
```
Media protocol request: media://%2FUsers%2Fchris%2FDownloads%2FTestMOV%2Fout2%2Fconcatenated_output.mp4
Resolved file path: /Users/chris/Downloads/TestMOV/out2/concatenated_output.mp4
File size: 12345678 bytes
MIME type: video/mp4
Streaming video file successfully
```

### Common Issues:

**Issue**: "Not allowed to load local resource"
- **Fixed**: This should be resolved with the new CSP headers

**Issue**: "File not found" in console
- **Cause**: The file path encoding might be wrong
- **Solution**: Check that the file actually exists at the path shown

**Issue**: Video element shows but doesn't play
- **Cause**: Codec might not be supported
- **Solution**: Try a different MP4 file or re-encode with H.264

**Issue**: "Unable to play media" error in DevTools
- **Cause**: Could be missing MIME type headers or unsupported codec
- **Debug Steps**:
  1. Check terminal console for these messages:
     - "File size: X bytes"
     - "MIME type: video/mp4"
     - "Streaming video file successfully"
  2. If you see these messages, the protocol is working
  3. Check the video codec with ffprobe:
     ```bash
     ffprobe /path/to/your/video.mp4
     ```
  4. Look for "Video: h264" in the output - if it says something else, the codec might not be supported
  5. Try re-encoding the video:
     ```bash
     ffmpeg -i input.mp4 -c:v libx264 -c:a aac output.mp4
     ```

## Video Format Support:

Best compatibility:
- **Container**: MP4
- **Video Codec**: H.264
- **Audio Codec**: AAC

GoPro videos (.MP4 with H.264) should work perfectly.

## Testing the Features:

### Event Time Sync:
1. Set "Event Start Time" (e.g., 08:00:00)
2. Set "Recording Start Time" (e.g., 08:05:30)
3. Play the video
4. Watch the "Event Time" update in real-time

### Trim Markers:
1. Play the video to a point you want to mark
2. Click the 📍 button next to "Start Time"
3. Play to the end point
4. Click the 📍 button next to "End Time"
5. See the green START and red END markers appear on the timeline
6. Click the markers to seek to those positions

### Processing:
1. Set your trim points
2. Check "Re-encode" if needed
3. Check "Mute" to remove audio
4. Click "Process Video"
5. Wait for completion
6. New processed video should appear in preview
