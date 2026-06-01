import { useState, useMemo } from 'react'
import { getAboutData } from '../mockData'

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ display:'inline', verticalAlign:'middle', marginLeft:3, marginBottom:1 }}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  )
}

export default function AboutPanel({ ticker, realData, realFounded }) {
  const [expanded, setExpanded] = useState(false)
  const mock = useMemo(() => getAboutData(ticker), [ticker])
  const data = {
    // realFounded arrives from its own endpoint (Wikidata); fall back to mock while loading
    founded:     realFounded ?? mock.founded,
    employees:   realData?.employees   ?? mock.employees,
    ceo:         realData?.ceo         ?? mock.ceo,
    website:     realData?.website     ?? mock.website,
    description: realData?.description ?? mock.description,
  }

  return (
    <div className="card about-panel">
      <h3 className="about-title">About the Company</h3>

      <div className="about-stats">
        <div className="about-stat">
          <span className="about-stat-label">Founded</span>
          <span className="about-stat-value">{data.founded}</span>
        </div>
        <div className="about-stat">
          <span className="about-stat-label">Employees</span>
          <span className="about-stat-value">{data.employees}</span>
        </div>
        <div className="about-stat">
          <span className="about-stat-label">CEO</span>
          <span className="about-stat-value">{data.ceo}</span>
        </div>
        <div className="about-stat">
          <span className="about-stat-label">Website</span>
          <a
            href={`https://${data.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
            onClick={e => e.stopPropagation()}
          >
            {data.website}<ExternalIcon />
          </a>
        </div>
      </div>

      <p className={`about-desc${expanded ? ' expanded' : ''}`}>
        {data.description}
      </p>

      <button className="about-toggle" onClick={() => setExpanded(e => !e)}>
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}
