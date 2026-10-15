import { useCover } from './lib/useCover.js'

export default function RecordThumbnail({ coverPath }) {
  const cover = useCover(coverPath)
  return (
    <span className="record-thumbnail">
      {cover.url && !cover.error ? (
        <img src={cover.url} alt="" loading="lazy" onError={cover.fail} />
      ) : (
        <span className="record-thumbnail-placeholder">
          {!coverPath ? '无封面' : cover.error ? '封面暂不可用' : '加载中…'}
        </span>
      )}
    </span>
  )
}
