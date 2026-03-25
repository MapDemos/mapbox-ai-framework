/**
 * SpeechRecognitionManager - Handle browser speech recognition and audio recording
 *
 * Supports two modes:
 * 1. Web Speech API (Chrome, Safari) - Direct browser-based speech recognition
 * 2. MediaRecorder + Google Cloud Speech-to-Text - Universal fallback via Lambda proxy
 *
 * The manager automatically detects the best available method based on:
 * - Browser capabilities
 * - Device type (TV, mobile, desktop)
 * - Configuration settings
 */

import { errorLogger } from './error-logger.js';

export class SpeechRecognitionManager {
  constructor(config, i18n, lambdaUrl) {
    this.config = config;
    this.i18n = i18n;
    this.lambdaUrl = lambdaUrl;

    // Recording state
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;

    // Web Speech API
    this.recognition = null;
    this.useWebSpeechAPI = false;

    // Silence detection (for MediaRecorder mode)
    this.audioContext = null;
    this.analyser = null;
    this.silenceDetectionInterval = null;
    this.lastSoundTime = null;
    this.SILENCE_THRESHOLD = config.SPEECH_SILENCE_THRESHOLD || 0.01; // Volume threshold
    this.SILENCE_DURATION = config.SPEECH_SILENCE_DURATION || 2000; // 2 seconds of silence
    this.MIN_RECORDING_TIME = config.SPEECH_MIN_RECORDING_TIME || 500; // Minimum 0.5s recording
    this.recordingStartTime = null;

    // Callbacks
    this.onTranscriptCallback = null;
    this.onErrorCallback = null;
    this.onStartCallback = null;
    this.onStopCallback = null;

    // Initialize based on capabilities
    this.initialize();
  }

  /**
   * Initialize speech recognition based on browser capabilities
   */
  initialize() {
    // Check if Web Speech API is available
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Detect webOS TV (LG Smart TVs)
    const isWebOS = navigator.userAgent.includes('Web0S') || navigator.userAgent.includes('webOS');

    // Determine which method to use
    // Use MediaRecorder for TVs and when explicitly configured
    // Use Web Speech API for supported desktop/mobile browsers
    const forceMediaRecorder = this.config.SPEECH_USE_MEDIA_RECORDER === true;

    if (!forceMediaRecorder && !isWebOS && SpeechRecognition) {
      this.useWebSpeechAPI = true;
      this.initializeWebSpeechAPI();
    } else {
      this.useWebSpeechAPI = false;
      // MediaRecorder will be initialized when recording starts
    }
  }

  /**
   * Initialize Web Speech API
   */
  initializeWebSpeechAPI() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      errorLogger.log('SpeechRecognition', new Error('Web Speech API not supported'));
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false; // Stop after one result
    this.recognition.interimResults = false; // Only final results

    // Set language based on i18n
    const currentLang = this.i18n.getCurrentLanguage();
    this.recognition.lang = currentLang === 'ja' ? 'ja-JP' : currentLang === 'ko' ? 'ko-KR' : 'en-US';

    // Handle results
    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (this.onTranscriptCallback) {
        this.onTranscriptCallback(transcript);
      }
    };

    // Handle errors
    this.recognition.onerror = (event) => {
      errorLogger.log('SpeechRecognition', event.error);
      if (this.onErrorCallback) {
        this.onErrorCallback(event.error);
      }
    };

    // Handle end
    this.recognition.onend = () => {
      this.isRecording = false;
      if (this.onStopCallback) {
        this.onStopCallback();
      }
    };
  }

  /**
   * Start recording audio
   */
  async startRecording() {
    if (this.isRecording) {
      return;
    }

    try {
      if (this.useWebSpeechAPI && this.recognition) {
        // Use Web Speech API
        this.isRecording = true;

        // Update language before starting
        const currentLang = this.i18n.getCurrentLanguage();
        this.recognition.lang = currentLang === 'ja' ? 'ja-JP' : 'en-US';

        try {
          this.recognition.start();
        } catch (startError) {
          // If start() fails (e.g., already started), try aborting and reinitializing
          if (startError.message && startError.message.includes('already')) {
            this.recognition.abort();
            // Wait a bit for abort to complete
            await new Promise(resolve => setTimeout(resolve, 100));
            this.recognition.start();
          } else {
            throw startError;
          }
        }

        if (this.onStartCallback) {
          this.onStartCallback();
        }
      } else {
        // Use MediaRecorder
        await this.startMediaRecording();
      }
    } catch (error) {
      this.isRecording = false; // Reset state on error
      errorLogger.log('StartRecording', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error.message || 'Failed to start recording');
      }
    }
  }

  /**
   * Start MediaRecorder-based recording
   */
  async startMediaRecording() {
    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000
        }
      });

      // Determine audio MIME type
      const mimeType = this.getSupportedMimeType();

      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        await this.processRecording();
      };

      this.mediaRecorder.onerror = (event) => {
        errorLogger.log('MediaRecorder', event.error);
        if (this.onErrorCallback) {
          this.onErrorCallback('Recording failed');
        }
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      // Initialize silence detection
      this.initializeSilenceDetection(this.stream);

      if (this.onStartCallback) {
        this.onStartCallback();
      }
    } catch (error) {
      errorLogger.log('MediaRecording', error);

      // Clean up
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }

      if (this.onErrorCallback) {
        this.onErrorCallback(error.message || 'Failed to access microphone');
      }
    }
  }

  /**
   * Get supported MIME type for MediaRecorder
   */
  getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return ''; // Let browser choose default
  }

  /**
   * Stop recording
   */
  async stopRecording() {
    if (!this.isRecording) {
      return;
    }

    try {
      // Stop silence detection
      this.stopSilenceDetection();

      if (this.useWebSpeechAPI && this.recognition) {
        this.recognition.stop();
      } else if (this.mediaRecorder) {
        this.mediaRecorder.stop();
      }
    } catch (error) {
      errorLogger.log('StopRecording', error);
      if (this.onErrorCallback) {
        this.onErrorCallback('Failed to stop recording');
      }
    }
  }

  /**
   * Initialize silence detection for MediaRecorder mode
   */
  initializeSilenceDetection(stream) {
    try {
      // Create audio context for analysis
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();

      // Configure analyser
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect stream to analyser
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);

      // Start monitoring audio levels
      this.lastSoundTime = Date.now();
      this.startSilenceMonitoring();
    } catch (error) {
      errorLogger.log('SilenceDetection', error);
      // Continue without silence detection if it fails
    }
  }

  /**
   * Start monitoring audio levels for silence detection
   */
  startSilenceMonitoring() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.silenceDetectionInterval = setInterval(() => {
      if (!this.isRecording) {
        this.stopSilenceDetection();
        return;
      }

      // Get current audio level
      this.analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS (Root Mean Square) for volume level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Check if sound is detected
      if (rms > this.SILENCE_THRESHOLD) {
        this.lastSoundTime = Date.now();
      }

      // Check if silence duration exceeded
      const silenceDuration = Date.now() - this.lastSoundTime;
      const recordingDuration = Date.now() - this.recordingStartTime;

      // Auto-stop if:
      // 1. Minimum recording time has passed
      // 2. Silence duration threshold exceeded
      if (recordingDuration > this.MIN_RECORDING_TIME &&
          silenceDuration > this.SILENCE_DURATION) {
        this.stopRecording();
      }
    }, 100); // Check every 100ms
  }

  /**
   * Stop silence detection and clean up audio context
   */
  stopSilenceDetection() {
    if (this.silenceDetectionInterval) {
      clearInterval(this.silenceDetectionInterval);
      this.silenceDetectionInterval = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(err => {
        errorLogger.log('AudioContextClose', err);
      });
      this.audioContext = null;
    }

    this.analyser = null;
    this.lastSoundTime = null;
  }

  /**
   * Process recorded audio and send to Google Speech-to-Text API
   */
  async processRecording() {
    try {
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

      // Stop all audio tracks
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }

      this.isRecording = false;

      if (this.onStopCallback) {
        this.onStopCallback();
      }

      // Convert to base64 for API transmission
      const base64Audio = await this.blobToBase64(audioBlob);

      // Send to Lambda proxy for Google Speech-to-Text
      const transcript = await this.transcribeAudio(base64Audio);

      if (this.onTranscriptCallback && transcript) {
        this.onTranscriptCallback(transcript);
      }
    } catch (error) {
      errorLogger.log('ProcessRecording', error);
      if (this.onErrorCallback) {
        this.onErrorCallback('Failed to process recording');
      }
    } finally {
      // Clean up
      this.audioChunks = [];
      this.mediaRecorder = null;
    }
  }

  /**
   * Convert Blob to base64 string
   */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Send audio to Lambda proxy for Google Speech-to-Text transcription
   */
  async transcribeAudio(base64Audio) {
    try {
      const currentLang = this.i18n.getCurrentLanguage();
      const languageCode = currentLang === 'ja' ? 'ja-JP' : 'en-US';

      const response = await fetch(this.lambdaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: 'google-speech',
          audioData: base64Audio,
          languageCode: languageCode
        })
      });

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Extract transcript from Google Speech-to-Text response
      const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;

      if (!transcript) {
        throw new Error('No transcript received from speech recognition service');
      }

      return transcript;
    } catch (error) {
      errorLogger.log('Transcription', error);
      throw error;
    }
  }

  /**
   * Set callback for when transcript is ready
   */
  onTranscript(callback) {
    this.onTranscriptCallback = callback;
  }

  /**
   * Set callback for errors
   */
  onError(callback) {
    this.onErrorCallback = callback;
  }

  /**
   * Set callback for recording start
   */
  onStart(callback) {
    this.onStartCallback = callback;
  }

  /**
   * Set callback for recording stop
   */
  onStop(callback) {
    this.onStopCallback = callback;
  }

  /**
   * Check if speech recognition is supported
   */
  isSupported() {
    const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasMediaRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

    return hasWebSpeech || hasMediaRecorder;
  }

  /**
   * Get the current recognition method being used
   */
  getRecognitionMethod() {
    if (this.useWebSpeechAPI) {
      return 'Web Speech API';
    } else {
      return 'MediaRecorder + Google Cloud Speech-to-Text';
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    // Stop any active recording
    if (this.isRecording) {
      this.stopRecording();
    }

    // Clean up Web Speech API
    if (this.recognition) {
      this.recognition.abort();
      this.recognition = null;
    }

    // Clean up MediaRecorder
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.mediaRecorder) {
      this.mediaRecorder = null;
    }

    this.audioChunks = [];
  }
}
