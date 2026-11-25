import { useState } from 'react'
import { whenImageReady } from './lib/imageReady.js'

export default function RecordThumbnail({ coverPath }) {
  const [failedPath, setFailedPath] = useState(null)
  const [loadedPath, setLoadedPath] = useState(null)
  const failed = !!coverPath && failedPath === coverPath
  const loading = !!coverPath && !failed && loadedPath !== coverPath
  return (
    <span className="record-thumbnail">
      {coverPath && !failed ? (
        <>
          {loading && <span className="cover-loading" aria-label="封面加载中" />}
          <img
            src={`/api/covers/${encodeURIComponent(coverPath)}`}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={(event) => whenImageReady(event.currentTarget, () => setLoadedPath(coverPath), () => setFailedPath(coverPath))}
            onError={() => setFailedPath(coverPath)}
          />
        </>
      ) : (
        <span className="record-thumbnail-placeholder">
          {!coverPath ? '无封面' : '封面暂不可用'}
        </span>
      )}
    </span>
  )
}
