// Keep the placeholder until the loaded image is decoded and ready to render.
export async function whenImageReady(image, onReady, onError) {
  const source = image.getAttribute('src')
  try {
    if (typeof image.decode === 'function') await image.decode()
  } catch {
    // Some browsers reject decode even when the image has already loaded.
    if (!image.complete || !image.naturalWidth) {
      if (image.isConnected && image.getAttribute('src') === source) onError()
      return
    }
  }
  requestAnimationFrame(() => {
    if (image.isConnected && image.getAttribute('src') === source) onReady()
  })
}
