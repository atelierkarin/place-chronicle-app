import { useEffect, useState, type FormEvent } from 'react'
import { places, visits, visitsForPlace, type Place, type Visit } from './demo-data'

type Page = 'timeline' | 'places' | 'new'
type Health = 'checking' | 'connected' | 'offline'

function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function getPlace(placeId: string): Place {
  return places.find((place) => place.id === placeId)!
}

function VisitCard({ visit, onPlaceClick }: { visit: Visit; onPlaceClick: (id: string) => void }) {
  const place = getPlace(visit.placeId)
  return (
    <article className="visit-card">
      <div className="visit-date">{formatDate(visit.date)}</div>
      <button className="place-title" type="button" onClick={() => onPlaceClick(place.id)}>
        {place.name} <span aria-hidden="true">↗</span>
      </button>
      <div className="visit-meta">
        {place.area} · {place.category}
      </div>
      <p>{visit.note}</p>
    </article>
  )
}

export function App() {
  const [page, setPage] = useState<Page>('timeline')
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [health, setHealth] = useState<Health>('checking')
  const [draftPlaceId, setDraftPlaceId] = useState(places[0].id)
  const [draftDate, setDraftDate] = useState('2026-10-11')
  const [draftText, setDraftText] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API unavailable')
        const body: { status: string; database: string } = await response.json()
        setHealth(body.status === 'ok' && body.database === 'ok' ? 'connected' : 'offline')
      })
      .catch(() => {
        if (!controller.signal.aborted) setHealth('offline')
      })
    return () => controller.abort()
  }, [])

  function navigate(nextPage: Page) {
    setPage(nextPage)
    setSelectedPlaceId(null)
  }

  function openPlace(id: string) {
    setSelectedPlaceId(id)
    setPage('places')
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShowPreview(true)
  }

  const selectedPlace = selectedPlaceId ? getPlace(selectedPlaceId) : null
  const selectedVisits = selectedPlace ? visitsForPlace(selectedPlace.id) : []

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">✳</span>
          <span>
            Place
            <br />
            Chronicle
          </span>
        </div>
        <div className="sidebar-label">自分の足跡を、見返す場所。</div>
        <nav aria-label="メインナビゲーション" className="nav-list">
          <button
            className={page === 'timeline' ? 'active' : ''}
            onClick={() => navigate('timeline')}
          >
            ▤ <span>タイムライン</span>
          </button>
          <button className={page === 'places' ? 'active' : ''} onClick={() => navigate('places')}>
            ⌖ <span>場所</span>
          </button>
          <button className={page === 'new' ? 'active' : ''} onClick={() => navigate('new')}>
            ＋ <span>記録する</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className={`status-dot ${health}`} />
          {health === 'connected'
            ? 'API・DB 接続中'
            : health === 'checking'
              ? '接続確認中'
              : 'API・DB 未接続'}
          <small>M0 画面プロトタイプ</small>
        </div>
      </aside>

      <main className="main-content">
        <div className="prototype-note">
          M0 プロトタイプ · 架空のデータ10件 · 保存機能はM1で実装
        </div>
        {page === 'timeline' && (
          <>
            <header className="page-header">
              <div>
                <div className="eyebrow">CHRONICLE / 訪問の記録</div>
                <h1>
                  訪れた日々を、
                  <br />
                  もう一度。
                </h1>
                <p>場所に重なる、あの日の小さな記憶。</p>
              </div>
              <div className="header-count">
                <strong>10</strong>
                <span>訪問の記録</span>
              </div>
            </header>
            <div className="section-heading">
              <h2>最近の訪問</h2>
              <span>新しい順</span>
            </div>
            <div className="visit-grid">
              {visits.map((visit) => (
                <VisitCard key={visit.id} visit={visit} onPlaceClick={openPlace} />
              ))}
            </div>
          </>
        )}

        {page === 'places' && !selectedPlace && (
          <>
            <header className="page-header">
              <div>
                <div className="eyebrow">PLACES / 訪れた場所</div>
                <h1>
                  また行きたい場所が、
                  <br />
                  ここにある。
                </h1>
                <p>一つの場所に、何度でも記録を重ねられます。</p>
              </div>
              <div className="header-count">
                <strong>{places.length}</strong>
                <span>登録した場所</span>
              </div>
            </header>
            <div className="section-heading">
              <h2>場所の一覧</h2>
              <span>訪問回数を表示</span>
            </div>
            <div className="place-list">
              {places.map((place) => (
                <button key={place.id} className="place-row" onClick={() => openPlace(place.id)}>
                  <span>
                    <strong>{place.name}</strong>
                    <small>
                      {place.area} · {place.category}
                    </small>
                  </span>
                  <span className="visit-badge">{visitsForPlace(place.id).length}回の訪問</span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </>
        )}

        {page === 'places' && selectedPlace && (
          <>
            <button className="back-button" onClick={() => setSelectedPlaceId(null)}>
              ← すべての場所
            </button>
            <header className="page-header detail-header">
              <div>
                <div className="eyebrow">PLACE / 場所の記録</div>
                <h1>{selectedPlace.name}</h1>
                <p>
                  {selectedPlace.area} · {selectedPlace.category}
                </p>
              </div>
              <div className="header-count">
                <strong>{selectedVisits.length}</strong>
                <span>回の訪問</span>
              </div>
            </header>
            <div className="section-heading">
              <h2>この場所での記録</h2>
              <span>新しい順</span>
            </div>
            <div className="visit-grid">
              {selectedVisits.map((visit) => (
                <VisitCard key={visit.id} visit={visit} onPlaceClick={openPlace} />
              ))}
            </div>
          </>
        )}

        {page === 'new' && (
          <>
            <header className="page-header">
              <div>
                <div className="eyebrow">NEW VISIT / 記録する</div>
                <h1>
                  今日の記憶を、
                  <br />
                  残しておく。
                </h1>
                <p>まずは場所と日付、短い感想から。</p>
              </div>
            </header>
            <div className="draft-layout">
              <form className="draft-form" onSubmit={preview}>
                <label>
                  訪れた場所
                  <select
                    value={draftPlaceId}
                    onChange={(event) => {
                      setDraftPlaceId(event.target.value)
                      setShowPreview(false)
                    }}
                  >
                    {places.map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  訪問日
                  <input
                    type="date"
                    value={draftDate}
                    onChange={(event) => {
                      setDraftDate(event.target.value)
                      setShowPreview(false)
                    }}
                    required
                  />
                </label>
                <label>
                  ひとこと
                  <textarea
                    value={draftText}
                    onChange={(event) => {
                      setDraftText(event.target.value)
                      setShowPreview(false)
                    }}
                    placeholder="その日のことを少しだけ"
                    rows={5}
                  />
                </label>
                <button className="primary-button" type="submit">
                  プレビューを見る →
                </button>
                <p className="form-note">この画面は入力導線の確認用です。内容は保存されません。</p>
              </form>
              <div className="preview-panel">
                <div className="eyebrow">PREVIEW / 表示イメージ</div>
                {showPreview ? (
                  <>
                    <h2>{getPlace(draftPlaceId).name}</h2>
                    <span>{formatDate(draftDate)}</span>
                    <p>{draftText || '感想は空欄です。'}</p>
                  </>
                ) : (
                  <>
                    <h2>記録のプレビュー</h2>
                    <p>左のフォームを入力して、表示を確認できます。</p>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
