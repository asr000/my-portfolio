import ThemeToggle from './ThemeToggle.jsx'

export default function PageTopbar({ back, backLabel, onBack, children }) {
  return (
    <div className="page-topbar">
      <a className="record-back" href={back} onClick={onBack}>
        ← {backLabel}
      </a>
      <div className="page-topbar-actions">
        {children}
        <ThemeToggle />
      </div>
    </div>
  )
}
