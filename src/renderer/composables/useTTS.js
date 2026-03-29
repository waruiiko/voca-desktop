/**
 * Shared TTS helper — reads ttsVoice from saved settings.
 * Usage: const { speak } = useTTS()
 *        speak('hello', 'en-US')
 */
export function useTTS() {
  async function speak(text, lang = 'en-US') {
    if (!text) return;
    speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang;

    try {
      const settings = await window.vocaAPI.loadSettings();
      const voiceName = settings.ttsVoice;
      if (voiceName) {
        // Voices may not be ready yet — wait briefly if needed
        let voices = speechSynthesis.getVoices();
        if (!voices.length) {
          await new Promise(res => {
            speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); res(); };
            setTimeout(res, 500); // fallback
          });
        }
        const match = voices.find(v => v.name === voiceName);
        if (match) utt.voice = match;
      }
    } catch { /* settings load failure — use default */ }

    speechSynthesis.speak(utt);
  }

  return { speak };
}
