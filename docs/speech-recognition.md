# Speech Recognition

The Mapbox AI Framework includes built-in speech recognition capabilities that work across different platforms including desktop browsers, mobile devices, and LG webOS TVs.

## Features

- **Dual-mode operation**: Automatically selects the best recognition method based on device capabilities
  - Web Speech API (Chrome, Safari) - Fast, free, browser-native
  - MediaRecorder + Google Cloud Speech-to-Text - Universal fallback via Lambda proxy
- **Multi-language support**: Automatically uses the current language from i18n (English, Japanese, etc.)
- **Platform-specific optimizations**: Optimized for LG webOS TVs and other platforms
- **Visual feedback**: Recording state indicators
- **Error handling**: Graceful degradation and user-friendly error messages

## Quick Start

### 1. Enable Speech Recognition

In your config.js:

```javascript
export const CONFIG = {
  // ... other config

  // Speech Recognition (optional - enabled by default)
  SPEECH_RECOGNITION_ENABLED: true,  // Set to false to disable
  SPEECH_AUTO_SEND: true,            // Auto-send message after transcription
  SPEECH_USE_MEDIA_RECORDER: false,  // Force MediaRecorder mode (for testing)
};
```

### 2. Add Microphone Button to HTML

Add a microphone button to your chat interface:

```html
<!-- In your index.html, add this button next to the send button -->
<button id="micBtn" class="mic-button" title="Voice input">
  <span id="micIcon">🎤</span>
</button>
```

### 3. Add CSS Styling

```css
/* Microphone button */
.mic-button {
  padding: 10px 15px;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 20px;
  transition: background-color 0.3s;
}

.mic-button:hover {
  background-color: #45a049;
}

.mic-button.recording {
  background-color: #f44336;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

### 4. Configure Lambda Environment Variables

For MediaRecorder mode (Google Cloud Speech-to-Text), set this environment variable in your Lambda function:

```bash
GOOGLE_SPEECH_API_KEY=your_google_cloud_api_key
# OR
GOOGLE_API_KEY=your_google_cloud_api_key
```

### 5. Add Translation Keys

Add these translation keys to your translations file:

```javascript
export const translations = {
  en: {
    // ... other translations
    error: {
      speechRecognitionTitle: 'Speech Recognition Error',
      speechRecognitionMessage: 'Failed to recognize speech. Please try again.',
      microphonePermissionMessage: 'Microphone access denied. Please allow microphone access in your browser settings.',
      noSpeechMessage: 'No speech detected. Please try again.',
    }
  },
  ja: {
    // ... other translations
    error: {
      speechRecognitionTitle: '音声認識エラー',
      speechRecognitionMessage: '音声認識に失敗しました。もう一度お試しください。',
      microphonePermissionMessage: 'マイクへのアクセスが拒否されました。ブラウザ設定でマイクアクセスを許可してください。',
      noSpeechMessage: '音声が検出されませんでした。もう一度お試しください。',
    }
  }
};
```

## How It Works

### Detection Logic

The framework automatically detects the best speech recognition method:

1. **Web Speech API** (preferred for desktop/mobile)
   - Used on: Chrome, Edge, Safari (iOS 14.5+, macOS)
   - Advantages: Fast, free, no API key needed
   - Disadvantages: Chrome sends audio to Google servers, not available on Firefox

2. **MediaRecorder + Google Speech-to-Text** (universal fallback)
   - Used on: LG webOS TVs, Firefox, or when explicitly configured
   - Advantages: Works everywhere, highly accurate, supports many languages
   - Disadvantages: Requires Google API key, costs ~$0.006 per 15 seconds

### Recognition Flow

#### Web Speech API Mode:
```
User clicks mic → Browser starts recording →
Real-time transcription → Text appears in input →
Optional auto-send
```

#### MediaRecorder Mode:
```
User clicks mic → MediaRecorder starts →
Audio chunks collected → User clicks stop →
Audio sent to Lambda → Lambda forwards to Google Speech API →
Transcript returned → Text appears in input →
Optional auto-send
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `SPEECH_RECOGNITION_ENABLED` | boolean | `true` | Enable/disable speech recognition |
| `SPEECH_AUTO_SEND` | boolean | `true` | Auto-send message after transcription |
| `SPEECH_USE_MEDIA_RECORDER` | boolean | `false` | Force MediaRecorder mode (for testing) |
| `CLAUDE_API_PROXY` or `LAMBDA_URL` | string | required | Lambda proxy URL for Google Speech API |

## Platform Support

| Platform | Recognition Method | Status |
|----------|-------------------|--------|
| Chrome Desktop | Web Speech API | ✅ Fully supported |
| Chrome Mobile | Web Speech API | ✅ Fully supported |
| Safari macOS | Web Speech API | ✅ Fully supported |
| Safari iOS 14.5+ | Web Speech API | ✅ Fully supported |
| Edge Desktop | Web Speech API | ✅ Fully supported |
| Firefox | MediaRecorder + Google | ✅ Fully supported |
| LG webOS TV | MediaRecorder + Google | ✅ Fully supported |

## Language Support

The speech recognition automatically uses the current language from your i18n configuration:

- `en` → `en-US` (English, United States)
- `ja` → `ja-JP` (Japanese, Japan)

To add more languages, extend the language mapping in `SpeechRecognitionManager.initializeWebSpeechAPI()` and `SpeechRecognitionManager.transcribeAudio()`.

## API Usage and Pricing

### Web Speech API
- **Cost**: Free
- **Limitations**: Requires internet connection (Chrome), data sent to Google

### Google Cloud Speech-to-Text
- **Pricing**: $0.006 per 15 seconds
- **Free tier**: First 60 minutes per month free
- **Supported languages**: 125+ languages
- **Documentation**: https://cloud.google.com/speech-to-text/pricing

## Troubleshooting

### Microphone button doesn't appear

1. Check that `SPEECH_RECOGNITION_ENABLED` is not set to `false`
2. Verify browser supports either Web Speech API or MediaRecorder
3. Check console for errors during initialization

### "Microphone access denied" error

1. Check browser permissions for microphone access
2. Ensure you're using HTTPS (required for microphone access)
3. On mobile, check app-level permissions

### Transcription not working

1. **Web Speech API mode**: Check internet connection
2. **MediaRecorder mode**:
   - Verify Lambda environment variable `GOOGLE_SPEECH_API_KEY` is set
   - Check Lambda logs for errors
   - Verify Google Cloud Speech-to-Text API is enabled in your Google Cloud project

### Poor transcription accuracy

1. Try a quieter environment
2. Speak clearly and at a normal pace
3. For MediaRecorder mode, ensure good audio quality
4. Consider using a better microphone

### Works on desktop but not on LG TV

1. Ensure TV has microphone access (external USB mic or Bluetooth)
2. Check webOS browser console for errors
3. Verify Lambda proxy is accessible from TV's network
4. Test with `SPEECH_USE_MEDIA_RECORDER: true` to force MediaRecorder mode

## Advanced Usage

### Custom Error Handling

You can customize error handling by overriding the `handleSpeechError` method in your app:

```javascript
class MyApp extends BaseApp {
  handleSpeechError(error) {
    // Custom error handling
    console.log('Speech error:', error);

    // Call parent implementation
    super.handleSpeechError(error);
  }
}
```

### Custom Transcript Handling

Override `handleSpeechTranscript` to customize what happens with the transcribed text:

```javascript
class MyApp extends BaseApp {
  handleSpeechTranscript(transcript) {
    // Pre-process transcript
    const processed = transcript.toLowerCase().trim();

    // Custom logic
    if (processed.startsWith('show me')) {
      // Handle specific commands
    }

    // Call parent implementation
    super.handleSpeechTranscript(processed);
  }
}
```

### Programmatic Control

You can control speech recognition programmatically:

```javascript
// Start recording
await app.speechRecognitionManager.startRecording();

// Stop recording
await app.speechRecognitionManager.stopRecording();

// Check if recording
const isRecording = app.speechRecognitionManager.isRecording;

// Check which method is being used
const method = app.speechRecognitionManager.getRecognitionMethod();
// Returns: "Web Speech API" or "MediaRecorder + Google Cloud Speech-to-Text"
```

## Security Considerations

1. **API Keys**: Never expose Google API keys in client-side code. Always use Lambda proxy.
2. **HTTPS Required**: Microphone access requires HTTPS (except localhost for development)
3. **Permissions**: Always request microphone permission with user interaction (button click)
4. **Privacy**:
   - Web Speech API (Chrome) sends audio to Google servers
   - MediaRecorder mode only sends audio when explicitly configured
   - Inform users about data transmission in your privacy policy

## Examples

See the `japan-daytrip-mcp` project for a complete working example of speech recognition in action.

## Debugging

Enable debug mode in your config:

```javascript
export const CONFIG = {
  DEBUG: true,  // Enable detailed logging
  SPEECH_RECOGNITION_ENABLED: true
};
```

Check the browser console for detailed logs:
- Speech recognition initialization
- Recognition method selection
- Recording start/stop events
- Transcription results
- Errors and warnings
