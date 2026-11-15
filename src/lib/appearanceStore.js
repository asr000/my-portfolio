const databaseName = 'portfolio-appearance'
const storeName = 'user-settings'

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持保存背景设置。'))
      return
    }
    const request = window.indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName, { keyPath: 'userId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开背景设置存储。'))
  })
}

async function runTransaction(userId, mode, action) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = action(transaction.objectStore(storeName), userId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('背景设置保存失败。'))
    transaction.oncomplete = () => database.close()
    transaction.onabort = () => {
      database.close()
      reject(transaction.error || new Error('背景设置保存失败。'))
    }
  })
}

export function loadAppearance(userId) {
  return runTransaction(userId, 'readonly', (store, id) => store.get(id))
}

export function saveAppearance(userId, settings) {
  return runTransaction(userId, 'readwrite', (store, id) =>
    store.put({ userId: id, ...settings }),
  )
}
