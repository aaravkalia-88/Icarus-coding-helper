// ICARUS artwork and lettering use the authored scene's existing texture slots.
// The scene's shaders, shrine, particles, camera, and controls remain upstream.
parent.postMessage({ type: 'icarus-scene', phase: 'loading' }, '*')
window.__ICARUS_ART_READY = (async () => {
  const logo = new Image()
  logo.src = window.__ICARUS_LOGO
  await logo.decode()
  await document.fonts.ready
  const subject = document.createElement('canvas')
  subject.width = 1024
  subject.height = 1536
  // Fit the supplied portrait inside the authored arch without blurring its figure.
  const art = subject.getContext('2d')
  art.save()
  art.beginPath()
  art.moveTo(122, 1420)
  art.lineTo(122, 510)
  art.quadraticCurveTo(122, 270, 512, 228)
  art.quadraticCurveTo(902, 270, 902, 510)
  art.lineTo(902, 1420)
  art.closePath()
  art.clip()
  art.drawImage(logo, 122, 84, 780, 780 * logo.height / logo.width)
  art.restore()
  const empty = document.createElement('canvas')
  empty.width = 1024
  empty.height = 1536
  const distance = document.createElement('canvas')
  distance.width = 1024
  distance.height = 1536
  const field = distance.getContext('2d')
  field.fillStyle = '#fff'
  field.fillRect(0, 0, distance.width, distance.height)
  const type = document.createElement('canvas')
  type.width = 2048
  type.height = 3072
  const text = type.getContext('2d')
  text.textAlign = 'center'
  function label(value, size, y, color, spacing) {
    text.font = `500 ${size}px Cinzel, serif`
    text.fillStyle = color
    text.letterSpacing = `${spacing}px`
    text.fillText(value, 1024, y)
  }
  // Upstream typography uses magenta for gold titles and green for fine type.
  label('ICARUS', 116, 278, '#ff00ff', 20)
  label('YOUR PROGRAMMING COMPANION', 23, 326, '#00ff00', 5)
  label('DARE TO ASCEND', 26, 2592, '#00ff00', 8)
  label('IGNITE YOUR MIND', 88, 2688, '#ff00ff', 2)
  Object.assign(window.__CARD_ASSETS, {
    'assets/subject.webp': subject.toDataURL(),
    'assets/lineart.webp': empty.toDataURL(),
    'assets/lineart_df.webp': distance.toDataURL(),
    'assets/type.webp': type.toDataURL(),
  })
})()
