import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

function RecordThumbnail({ coverPath }) {
  const [imageUrl, setImageUrl] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadCover() {
      if (!coverPath) {
        return
      }

      try {
        const { data, error } = await supabase
          .storage
          .from('record-covers')
          .createSignedUrl(coverPath, 3600)

        if (error) {
          throw error
        }

        if (!cancelled) {
          setImageUrl(data.signedUrl)
        }
      } catch {
        if (!cancelled) {
          setFailed(true)
        }
      }
    }

    loadCover()

    return () => {
      cancelled = true
    }
  }, [coverPath])

  return (
    <span className="record-thumbnail">
      {imageUrl && !failed ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="record-thumbnail-placeholder">
          {!coverPath ? '无封面' : failed ? '加载失败' : '加载中…'}
        </span>
      )}
    </span>
  )
}

export default RecordThumbnail