const PyCam = (() => {
  let activeStream = null;

  async function start(videoId) {
    const video = document.getElementById(videoId);
    if (!video || !navigator.mediaDevices?.getUserMedia) return;
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = activeStream;
    } catch (err) {
      console.error('Camera initialization error:', err);
    }
  }

  function captureBase64(videoId) {
    const video = document.getElementById(videoId);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  function stop() {
    if (activeStream) {
      activeStream.getTracks().forEach((t) => t.stop());
      activeStream = null;
    }
  }

  return { start, captureBase64, stop };
})();
