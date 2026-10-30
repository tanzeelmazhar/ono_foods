const heroVideo = document.querySelector("#hero-video");

if (heroVideo) {
  const play = () => heroVideo.play().catch(() => {});
  const inView = () => {
    const bounds = heroVideo.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < window.innerHeight;
  };

  if (heroVideo.readyState >= 2) play();
  else heroVideo.addEventListener("loadeddata", play, { once: true });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !document.hidden) play();
      else heroVideo.pause();
    }, { threshold: 0.05 });
    observer.observe(heroVideo);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !inView()) heroVideo.pause();
    else play();
  });
}
