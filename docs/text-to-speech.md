# Text-to-Speech (TTS)

The Mapbox AI Framework includes built-in text-to-speech capabilities with **two modes**:

1. **Web Speech API** (default) - Browser-native, free, works immediately
2. **Google Cloud Text-to-Speech** (premium) - WaveNet/Neural2 voices, much more natural

## Features

- **Hybrid TTS**: Choose between browser voices (free) or premium Google Cloud voices
- **Auto-speak mode**: Automatically speaks all AI responses
- **Per-message playback**: Speaker icons on each message for manual control
- **Multi-language support**: Automatic voice selection based on i18n language (English, Japanese, etc.)
- **Visual feedback**: Speaking state indicators
- **Pause/resume controls**: Full playback control
- **WaveNet/Neural2 voices**: Premium natural-sounding voices (Google Cloud TTS)

## Quick Start

### 1. Enable Text-to-Speech

In your config.js:

```javascript
export const CONFIG = {
  // ... other config

  // Text-to-Speech (optional - enabled by default)
  TTS_ENABLED: true,                  // Set to false to disable
  TTS_AUTO_SPEAK: false,              // Auto-speak all responses (default: false)
  TTS_USE_GOOGLE_CLOUD: false,        // Use Google Cloud TTS (default: false, uses Web Speech API)

  // Voice settings (optional)
  TTS_RATE: 1.0,                      // Speech rate (0.1-10, default: 1.0)
  TTS_PITCH: 1.0,                     // Voice pitch (0-2 for Web Speech, -20 to 20 for Google)
  TTS_VOLUME: 1.0,                    // Volume (0-1, default: 1.0)

  // Google Cloud TTS settings (when TTS_USE_GOOGLE_CLOUD is true)
  TTS_GOOGLE_VOICE_NAME: 'ja-JP-Neural2-B',  // Voice name (e.g., 'en-US-Neural2-F', 'ja-JP-Neural2-B')
  CLAUDE_API_PROXY: 'https://your-lambda-url', // Lambda URL (required for Google Cloud TTS)
};
```

### 2. Add Auto-Speak Toggle to HTML

Add a toggle button to your header (next to language toggle):

```html
<!-- In your index.html header -->
<button id="tts-toggle" class="tts-toggle-btn" title="Auto-speak responses">
  <span id="tts-icon">🔇</span>
</button>
```

### 3. (Optional) Enable Google Cloud TTS

For premium natural voices:

```javascript
// config.js
export const CONFIG = {
  TTS_USE_GOOGLE_CLOUD: true,
  TTS_GOOGLE_VOICE_NAME: 'ja-JP-Neural2-B',  // or 'en-US-Neural2-F'
  CLAUDE_API_PROXY: 'https://your-lambda-url.aws.com/',
};
```

**Lambda Environment Variable:**
```bash
# Add to your Lambda function
GOOGLE_TTS_API_KEY=your_google_cloud_api_key
# OR
GOOGLE_API_KEY=your_google_cloud_api_key  # Shared with Speech-to-Text
```

**Enable Google Cloud Text-to-Speech API:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable "Cloud Text-to-Speech API"
3. Create an API key
4. Add to Lambda environment variables

### 4. Add CSS Styling

```css
/* TTS Toggle Button */
.tts-toggle-btn {
  padding: 8px 12px;
  background-color: #757575;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1.2em;
  transition: all 0.2s;
}

.tts-toggle-btn:hover {
  background-color: #616161;
}

.tts-toggle-btn.active {
  background-color: #4CAF50;
}

.tts-toggle-btn.speaking {
  animation: pulse-speaking 1s infinite;
}

@keyframes pulse-speaking {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* Message Speaker Icons */
.message-speaker-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.2em;
  padding: 4px 8px;
  margin-left: 8px;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.message-speaker-icon:hover {
  opacity: 1;
}

.message-speaker-icon.speaking {
  opacity: 1;
  animation: pulse-speaking 1s infinite;
}
```

## How It Works

### Auto-Speak Mode

1. User clicks **auto-speak toggle** button (🔇 → 🔊)
2. All subsequent AI responses are **automatically spoken**
3. Visual indicator shows speaking state
4. Click toggle again to disable

### Manual Playback

1. Each assistant message has a **speaker icon** (🔊)
2. Click to **play/pause** that specific message
3. Only one message speaks at a time
4. Allows selective listening to past messages

### Voice Selection

The framework automatically selects the best voice for the current language:

- **Priority 1**: Local voice matching exact language (e.g., `en-US` local)
- **Priority 2**: Any voice matching exact language
- **Priority 3**: Voice matching language prefix (e.g., `en-*`)
- **Priority 4**: First available voice (fallback)

## TTS Modes Comparison

| Feature | Web Speech API | Google Cloud TTS |
|---------|----------------|------------------|
| **Cost** | Free | $16 per 1M characters (WaveNet/Neural2) |
| **Quality** | Good (varies by browser) | ⭐ Excellent, very natural |
| **Setup** | Zero config | Requires Lambda + API key |
| **Latency** | Instant | ~1-2 seconds |
| **Offline** | Yes (some browsers) | No (requires internet) |
| **Voices** | System voices | 200+ WaveNet/Neural2 voices |
| **Best for** | Desktop/mobile apps | LG TV, premium experiences |

### Which Should You Use?

- **Web Speech API**: Default choice, works immediately, good for most uses
- **Google Cloud TTS**: Enable for premium quality, especially for LG TV or when voice quality is critical

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `TTS_ENABLED` | boolean | `true` | Enable/disable text-to-speech |
| `TTS_AUTO_SPEAK` | boolean | `false` | Auto-speak all AI responses |
| `TTS_USE_GOOGLE_CLOUD` | boolean | `false` | Use Google Cloud TTS instead of Web Speech API |
| `TTS_RATE` | number | `1.0` | Speech rate (0.1-10, 1.0 = normal) |
| `TTS_PITCH` | number | `1.0` | Voice pitch (0-2 for Web Speech, -20 to 20 for Google) |
| `TTS_VOLUME` | number | `1.0` | Volume (0-1, 1.0 = max) |
| `TTS_GOOGLE_VOICE_NAME` | string | auto | Google Cloud voice name (e.g., 'ja-JP-Neural2-B') |
| `CLAUDE_API_PROXY` | string | required | Lambda URL (required for Google Cloud TTS) |

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Chrome Desktop | ✅ Fully supported | Multiple high-quality voices |
| Chrome Mobile | ✅ Fully supported | System voices |
| Safari macOS | ✅ Fully supported | High-quality voices |
| Safari iOS | ✅ Fully supported | System voices |
| Edge Desktop | ✅ Fully supported | Multiple voices |
| Firefox | ✅ Fully supported | System voices |
| LG webOS TV | ✅ Supported | Basic voice (if available) |

## Language Support

### Web Speech API

The TTS system automatically uses voices matching your i18n language:

- `en` → English voices (`en-US`, `en-GB`, etc.)
- `ja` → Japanese voices (`ja-JP`)
- Other languages supported by browser

Available voices vary by platform and operating system.

### Google Cloud TTS Voices

When using Google Cloud TTS, you can specify exact voice names. Here are some recommended voices:

#### English (US)
- `en-US-Neural2-A` - Male, natural
- `en-US-Neural2-C` - Female, natural
- `en-US-Neural2-F` - Female, warm and clear (recommended)
- `en-US-Neural2-J` - Male, clear
- `en-US-Wavenet-D` - Male, WaveNet quality
- `en-US-Wavenet-F` - Female, WaveNet quality

#### Japanese
- `ja-JP-Neural2-B` - Female, natural (recommended)
- `ja-JP-Neural2-C` - Male, natural
- `ja-JP-Neural2-D` - Male, professional
- `ja-JP-Wavenet-A` - Female, WaveNet quality
- `ja-JP-Wavenet-B` - Female, WaveNet quality
- `ja-JP-Wavenet-C` - Male, WaveNet quality
- `ja-JP-Wavenet-D` - Male, WaveNet quality

**Voice Types:**
- **Neural2**: Latest generation, most natural (recommended)
- **WaveNet**: High quality, very natural
- **Standard**: Basic quality (not recommended)

**Full voice list**: [Google Cloud TTS Voices](https://cloud.google.com/text-to-speech/docs/voices)

## API Reference

### TextToSpeechManager

#### Methods

```javascript
// Speak text
textToSpeechManager.speak(text, options);

// Control playback
textToSpeechManager.pause();
textToSpeechManager.resume();
textToSpeechManager.stop();

// Auto-speak mode
textToSpeechManager.toggleAutoSpeak();
textToSpeechManager.enableAutoSpeak();
textToSpeechManager.disableAutoSpeak();
textToSpeechManager.isAutoSpeakEnabled();

// Voice management
textToSpeechManager.getVoicesForCurrentLanguage();
textToSpeechManager.setVoice(voiceName);

// State
textToSpeechManager.getSpeakingState();
textToSpeechManager.isAvailable();
```

#### Callbacks

```javascript
textToSpeechManager.onStart(() => {
  console.log('Started speaking');
});

textToSpeechManager.onEnd(() => {
  console.log('Finished speaking');
});

textToSpeechManager.onError((error) => {
  console.error('TTS error:', error);
});
```

## Text Preprocessing

The TTS system automatically cleans text before speaking:

- **Removes markdown formatting**: `**bold**`, `*italic*`, `` `code` ``
- **Removes links**: `[text](url)` → `text`
- **Removes emojis**: 🎤🔊 (they don't speak well)
- **Normalizes whitespace**: Multiple spaces/newlines

This ensures natural, clear speech output.

## Troubleshooting

### No voices available

1. Wait a few seconds after page load (voices load asynchronously)
2. Check browser console for errors
3. Try reloading the page
4. Verify browser supports Web Speech API

### Voice sounds robotic

1. Try different voices using `setVoice()`
2. Adjust `TTS_RATE` (slower = 0.8, faster = 1.2)
3. Some platforms have better voices than others
4. Desktop Chrome typically has the best voices

### Auto-speak not working

1. Verify `TTS_AUTO_SPEAK: true` in config
2. Check that toggle button shows 🔊 (enabled state)
3. Ensure no errors in browser console
4. Try manually clicking speaker icon on a message

### Speaking stops unexpectedly

1. Browser may pause speech when tab loses focus
2. Check for JavaScript errors
3. Verify speech isn't being stopped by other code
4. Try resuming with `textToSpeechManager.resume()`

### Japanese voices sound wrong

1. Ensure system has Japanese voices installed
2. On macOS: System Preferences → Accessibility → Spoken Content
3. On Windows: Settings → Time & Language → Speech
4. Mobile devices use system voices

## Advanced Usage

### Custom Voice Selection

```javascript
class MyApp extends BaseApp {
  async onInitialized() {
    await super.onInitialized();

    if (this.textToSpeechManager) {
      // Get available voices
      const voices = this.textToSpeechManager.getVoicesForCurrentLanguage();
      console.log('Available voices:', voices);

      // Set preferred voice
      const preferredVoice = voices.find(v => v.name.includes('Google'));
      if (preferredVoice) {
        this.textToSpeechManager.setVoice(preferredVoice.name);
      }
    }
  }
}
```

### Custom Speech Options

```javascript
// Speak with custom rate/pitch/volume
this.textToSpeechManager.speak('Hello world', {
  rate: 1.2,    // 20% faster
  pitch: 0.9,   // Slightly lower pitch
  volume: 0.8   // 80% volume
});
```

### Programmatic Control

```javascript
// Start auto-speak programmatically
app.textToSpeechManager.enableAutoSpeak();
app.updateAutoSpeakButtonState();

// Speak a specific message
app.speakMessage('This is a test message', 'test-msg-id');

// Stop all speech
app.stopSpeaking();
```

## Accessibility

Text-to-speech greatly improves accessibility for:

- **Visually impaired users**: Can listen to AI responses
- **Multitasking users**: Can listen while doing other things
- **Learning disabilities**: Audio reinforcement of text
- **Language learners**: Hear proper pronunciation

### Best Practices:

1. **Provide visual feedback**: Show when speaking (icon animation)
2. **Allow manual control**: Speaker icons on each message
3. **Enable/disable globally**: Auto-speak toggle
4. **Keyboard shortcuts**: Consider adding hotkeys
5. **Respect user preferences**: Remember auto-speak state

## Performance

- **Minimal overhead**: Web Speech API is browser-native
- **No network calls**: Voices are local (most browsers)
- **No API costs**: Completely free
- **Fast**: Near-instant speech synthesis
- **Efficient**: No audio file downloads

## Privacy

- **Local processing**: Text-to-speech happens in the browser
- **No data sent**: No external API calls
- **No tracking**: No usage analytics
- **Offline capable**: Works without internet (depends on browser)

## Examples

See the `japan-daytrip-mcp` project for a complete working example of text-to-speech in action.

## Browser Compatibility

The Web Speech API is widely supported:

- ✅ Chrome 33+
- ✅ Edge 14+
- ✅ Safari 7+
- ✅ Firefox 49+
- ✅ Opera 21+
- ✅ iOS Safari 7+
- ✅ Chrome for Android

## Debugging

Enable debug logging in your config:

```javascript
export const CONFIG = {
  DEBUG: true,  // Enable detailed logging
  TTS_ENABLED: true
};
```

Check browser console for:
- TTS initialization
- Voice loading
- Speech start/end events
- Errors and warnings
