export default function RecordSource({ record }) {
  return (
    <span className="record-source">
      <span className="record-source-name">
        来源：{record.author_name || '网站作者'}
      </span>
      <span className="record-source-role">
        {record.author_role === 'member' ? '受邀作者' : '网站作者'}
      </span>
    </span>
  )
}
