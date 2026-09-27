// Local only: ensure failed images have a visible replacement before screenshot.
window.BH2_READY = Promise.all([document.fonts.ready, ...Array.from(document.images, image => new Promise(resolve => {
  let timer
  const done = ok => { clearTimeout(timer); if (!ok) { image.closest('.media,.avatar')?.classList.add('missing'); image.removeAttribute('src') } resolve() }
  if (image.complete) return done(image.naturalWidth > 0)
  image.addEventListener('load', () => done(true), {once:true})
  image.addEventListener('error', () => done(false), {once:true})
  // A remote avatar must never hold a Yunzai screenshot open for seconds.
  timer = setTimeout(() => done(false), 2500)
}))]).then(() => { document.documentElement.dataset.ready = 'true' })
