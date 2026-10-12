import { useEffect, useState, type FormEvent } from 'react'

type Place = {
  id: string
  name: string
  category: string | null
  latitude: number
  longitude: number
  address: string | null
  note: string | null
  createdAt: string
  visitCount?: number
}
type Photo = {
  id: string
  sortOrder: number
  caption: string | null
  thumbnailUrl: string
  originalUrl: string
  originalFilename: string
}
type Visit = {
  id: string
  placeId: string
  visitedAt: string
  text: string
  photos?: Photo[]
}
type Page<T> = { items: T[]; nextCursor: string | null }
type Screen = 'timeline' | 'places' | 'new-place' | 'new-visit'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.error?.fields ? Object.values(body.error.fields).join('、') : ''
    throw new Error(
      `${body?.error?.message ?? `通信エラー (${response.status})`}${detail ? `: ${detail}` : ''}${body?.error?.count ? ` (${body.error.count}件)` : ''}`,
    )
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
}

function json(method: string, body: object): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function localInput(value: string): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function nowInput(): string {
  return localInput(new Date().toISOString())
}

export function App() {
  const [screen, setScreen] = useState<Screen>('timeline')
  const [places, setPlaces] = useState<Place[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [placeVisits, setPlaceVisits] = useState<Visit[]>([])
  const [placeVisitCursor, setPlaceVisitCursor] = useState<string | null>(null)
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
  const [placeCursor, setPlaceCursor] = useState<string | null>(null)
  const [visitCursor, setVisitCursor] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [placeDraft, setPlaceDraft] = useState({
    name: '',
    category: '',
    latitude: '',
    longitude: '',
    address: '',
    note: '',
  })
  const [visitDraft, setVisitDraft] = useState({
    placeId: '',
    visitedAt: nowInput(),
    text: '',
  })
  const [editingPlace, setEditingPlace] = useState(false)
  const [editingVisit, setEditingVisit] = useState(false)
  const [files, setFiles] = useState<File[]>([])

  async function loadPlaces(append = false, cursor: string | null = null) {
    const result = await api<Page<Place>>(
      `/api/places?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    )
    setPlaces((current) => (append ? [...current, ...result.items] : result.items))
    setPlaceCursor(result.nextCursor)
  }

  async function loadVisits(append = false, cursor: string | null = null) {
    const result = await api<Page<Visit>>(
      `/api/visits?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    )
    setVisits((current) => (append ? [...current, ...result.items] : result.items))
    setVisitCursor(result.nextCursor)
  }

  useEffect(() => {
    Promise.all([loadPlaces(), loadVisits()]).catch((error) => setMessage(error.message))
  }, [])

  async function openPlace(id: string, strict = false) {
    try {
      const [place, records] = await Promise.all([
        api<Place>(`/api/places/${id}`),
        api<Page<Visit>>(`/api/visits?placeId=${id}&limit=50`),
      ])
      setSelectedPlace(place)
      setPlaceVisits(records.items)
      setPlaceVisitCursor(records.nextCursor)
      setSelectedVisit(null)
      setEditingPlace(false)
      setScreen('places')
      setMessage('')
    } catch (error) {
      if (strict) throw error
      setMessage((error as Error).message)
    }
  }

  async function openVisit(id: string, strict = false) {
    try {
      setSelectedVisit(await api<Visit>(`/api/visits/${id}`))
      setEditingVisit(false)
      setMessage('')
    } catch (error) {
      if (strict) throw error
      setMessage((error as Error).message)
    }
  }

  async function loadMorePlaceVisits() {
    if (!selectedPlace || !placeVisitCursor) return
    await run(async () => {
      const records = await api<Page<Visit>>(
        `/api/visits?placeId=${selectedPlace.id}&limit=50&cursor=${encodeURIComponent(placeVisitCursor)}`,
      )
      setPlaceVisits((current) => [...current, ...records.items])
      setPlaceVisitCursor(records.nextCursor)
    })
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function placeName(id: string) {
    return places.find((place) => place.id === id)?.name ?? '場所'
  }

  async function savePlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      const body = {
        ...placeDraft,
        latitude: Number(placeDraft.latitude),
        longitude: Number(placeDraft.longitude),
      }
      const result = await api<Place>(
        editingPlace && selectedPlace ? `/api/places/${selectedPlace.id}` : '/api/places',
        json(editingPlace ? 'PATCH' : 'POST', body),
      )
      setSelectedPlace(result)
      setEditingPlace(true)
      await loadPlaces()
      await openPlace(result.id, true)
      setPlaceDraft({
        name: '',
        category: '',
        latitude: '',
        longitude: '',
        address: '',
        note: '',
      })
      setMessage('場所を保存しました')
    })
  }

  async function saveVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      const body = {
        visitedAt: new Date(visitDraft.visitedAt).toISOString(),
        text: visitDraft.text,
        ...(!editingVisit ? { placeId: visitDraft.placeId } : {}),
      }
      const result = await api<Visit>(
        editingVisit && selectedVisit ? `/api/visits/${selectedVisit.id}` : '/api/visits',
        json(editingVisit ? 'PATCH' : 'POST', body),
      )
      setSelectedVisit(result)
      setEditingVisit(true)
      await loadVisits()
      try {
        await openPlace(result.placeId, true)
        await openVisit(result.id, true)
      } catch (error) {
        setSelectedVisit(result)
        setEditingVisit(true)
        throw error
      }
      setEditingVisit(true)
      setMessage('訪問を保存しました')
      if (files.length) await upload(result.id, files)
      setEditingVisit(false)
      setVisitDraft({
        placeId: result.placeId,
        visitedAt: nowInput(),
        text: '',
      })
      setFiles([])
    })
  }

  async function upload(id: string, selected: File[]) {
    const form = new FormData()
    selected.forEach((file) => form.append('files', file))
    await api(`/api/visits/${id}/photos`, { method: 'POST', body: form })
    setFiles([])
    try {
      await openVisit(id, true)
      setMessage('写真を保存しました')
    } catch {
      setMessage('写真を保存しました。詳細の再読み込みに失敗しました。')
    }
  }

  async function removePlace() {
    if (
      !selectedPlace ||
      !window.confirm(
        `「${selectedPlace.name}」を削除します。関連する訪問 ${selectedPlace.visitCount ?? 0} 件があります。削除しますか？`,
      )
    )
      return
    await run(async () => {
      await api(`/api/places/${selectedPlace.id}`, { method: 'DELETE' })
      setSelectedPlace(null)
      await loadPlaces()
      setMessage('場所を削除しました')
    })
  }

  async function removeVisit() {
    if (
      !selectedVisit ||
      !window.confirm(
        `訪問を削除します。関連する写真 ${selectedVisit.photos?.length ?? 0} 枚があります。削除しますか？`,
      )
    )
      return
    await run(async () => {
      await api(`/api/visits/${selectedVisit.id}`, { method: 'DELETE' })
      setSelectedVisit(null)
      await loadVisits()
      if (selectedPlace) await openPlace(selectedPlace.id)
      setMessage('訪問を削除しました')
    })
  }

  async function removePhoto(photo: Photo) {
    if (
      !selectedVisit ||
      !window.confirm(`写真「${photo.originalFilename}」の原本とサムネイルを削除しますか？`)
    )
      return
    await run(async () => {
      await api(`/api/photos/${photo.id}`, { method: 'DELETE' })
      await openVisit(selectedVisit.id)
      setMessage('写真を削除しました')
    })
  }

  async function movePhoto(photo: Photo, direction: -1 | 1) {
    if (!selectedVisit?.photos) return
    const ordered = [...selectedVisit.photos].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    )
    const index = ordered.findIndex((item) => item.id === photo.id)
    const other = ordered[index + direction]
    if (!other) return
    await run(async () => {
      const swapped = [...ordered]
      swapped[index] = other
      swapped[index + direction] = photo
      for (let position = 0; position < swapped.length; position++) {
        if (swapped[position].sortOrder !== position)
          await api(`/api/photos/${swapped[position].id}`, json('PATCH', { sortOrder: position }))
      }
      await openVisit(selectedVisit.id)
    })
  }

  function startPlaceEdit() {
    if (!selectedPlace) return
    setPlaceDraft({
      name: selectedPlace.name,
      category: selectedPlace.category ?? '',
      latitude: String(selectedPlace.latitude),
      longitude: String(selectedPlace.longitude),
      address: selectedPlace.address ?? '',
      note: selectedPlace.note ?? '',
    })
    setEditingPlace(true)
  }

  function startVisitEdit() {
    if (!selectedVisit) return
    setVisitDraft({
      placeId: selectedVisit.placeId,
      visitedAt: localInput(selectedVisit.visitedAt),
      text: selectedVisit.text,
    })
    setEditingVisit(true)
  }

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
            className={screen === 'timeline' ? 'active' : ''}
            onClick={() => {
              setScreen('timeline')
              setSelectedPlace(null)
              setSelectedVisit(null)
            }}
          >
            ▤ <span>訪問</span>
          </button>
          <button
            className={screen === 'places' ? 'active' : ''}
            onClick={() => {
              setScreen('places')
              setSelectedPlace(null)
              setSelectedVisit(null)
            }}
          >
            ⌖ <span>場所</span>
          </button>
          <button
            className={screen === 'new-place' ? 'active' : ''}
            onClick={() => {
              setScreen('new-place')
              setEditingPlace(false)
              setPlaceDraft({
                name: '',
                category: '',
                latitude: '',
                longitude: '',
                address: '',
                note: '',
              })
            }}
          >
            ＋ <span>場所を登録</span>
          </button>
          <button
            className={screen === 'new-visit' ? 'active' : ''}
            onClick={() => {
              setScreen('new-visit')
              setEditingVisit(false)
              setVisitDraft((draft) => ({
                ...draft,
                placeId: selectedPlace?.id ?? draft.placeId ?? places[0]?.id ?? '',
              }))
            }}
          >
            ＋ <span>訪問を記録</span>
          </button>
        </nav>
        <div className="sidebar-bottom">ローカル個人利用</div>
      </aside>
      <main className="main-content">
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {screen === 'timeline' && (
          <>
            <header className="page-header">
              <div>
                <div className="eyebrow">CHRONICLE / 訪問の記録</div>
                <h1>
                  訪れた日々を、
                  <br />
                  もう一度。
                </h1>
                <p>新しい訪問から表示します。</p>
              </div>
              <div className="header-count">
                <strong>{visits.length}</strong>
                <span>表示中の訪問</span>
              </div>
            </header>
            <div className="section-heading">
              <h2>最近の訪問</h2>
            </div>
            <div className="visit-grid">
              {visits.map((visit) => (
                <article className="visit-card" key={visit.id}>
                  <div className="visit-date">{localDate(visit.visitedAt)}</div>
                  <button className="place-title" onClick={() => openPlace(visit.placeId)}>
                    {placeName(visit.placeId)} ↗
                  </button>
                  <p>{visit.text || '感想はありません'}</p>
                  <button className="link-button" onClick={() => openVisit(visit.id)}>
                    訪問の詳細を見る
                  </button>
                </article>
              ))}
            </div>
            {!visits.length && (
              <p>訪問記録はまだありません。場所を登録してから記録してください。</p>
            )}
            {visitCursor && (
              <button
                className="secondary-button"
                onClick={() => run(() => loadVisits(true, visitCursor))}
              >
                続きを表示
              </button>
            )}
          </>
        )}
        {screen === 'places' && !selectedPlace && (
          <>
            <header className="page-header">
              <div>
                <div className="eyebrow">PLACES / 場所</div>
                <h1>
                  訪れた場所を、
                  <br />
                  残しておく。
                </h1>
              </div>
              <div className="header-count">
                <strong>{places.length}</strong>
                <span>表示中の場所</span>
              </div>
            </header>
            <div className="section-heading">
              <h2>場所の一覧</h2>
            </div>
            <div className="place-list">
              {places.map((place) => (
                <button className="place-row" key={place.id} onClick={() => openPlace(place.id)}>
                  <span>
                    <strong>{place.name}</strong>
                    <small>
                      {place.category ?? 'カテゴリなし'} · {place.address ?? '住所なし'}
                    </small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            {!places.length && <p>場所はまだありません。「場所を登録」から始めてください。</p>}
            {placeCursor && (
              <button
                className="secondary-button"
                onClick={() => run(() => loadPlaces(true, placeCursor))}
              >
                続きを表示
              </button>
            )}
          </>
        )}
        {screen === 'places' && selectedPlace && (
          <>
            <button
              className="back-button"
              onClick={() => {
                setSelectedPlace(null)
                setSelectedVisit(null)
              }}
            >
              ← すべての場所
            </button>
            <header className="page-header detail-header">
              <div>
                <div className="eyebrow">PLACE / 場所の記録</div>
                <h1>{selectedPlace.name}</h1>
                <p>
                  {selectedPlace.category ?? 'カテゴリなし'} · {selectedPlace.address ?? '住所なし'}
                </p>
                <p>
                  緯度 {selectedPlace.latitude} / 経度 {selectedPlace.longitude}
                </p>
                <p>{selectedPlace.note}</p>
              </div>
              <div className="header-count">
                <strong>{selectedPlace.visitCount ?? 0}</strong>
                <span>回の訪問</span>
              </div>
            </header>
            <div className="action-row">
              <button className="secondary-button" onClick={startPlaceEdit}>
                場所を編集
              </button>
              <button className="danger-button" onClick={removePlace} disabled={busy}>
                場所を削除
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setVisitDraft({
                    placeId: selectedPlace.id,
                    visitedAt: nowInput(),
                    text: '',
                  })
                  setScreen('new-visit')
                }}
              >
                この場所に訪問を追加
              </button>
            </div>
            {editingPlace && (
              <PlaceForm
                value={placeDraft}
                onChange={setPlaceDraft}
                onSubmit={savePlace}
                busy={busy}
              />
            )}
            <div className="section-heading">
              <h2>この場所での記録</h2>
              <span>新しい順</span>
            </div>
            <div className="visit-grid">
              {placeVisits.map((visit) => (
                <article key={visit.id} className="visit-card">
                  <div className="visit-date">{localDate(visit.visitedAt)}</div>
                  <p>{visit.text || '感想はありません'}</p>
                  <button className="link-button" onClick={() => openVisit(visit.id)}>
                    写真と詳細を見る
                  </button>
                </article>
              ))}
            </div>
            {!placeVisits.length && <p>訪問記録はまだありません。</p>}
            {placeVisitCursor && (
              <button className="secondary-button" onClick={loadMorePlaceVisits} disabled={busy}>
                この場所の続きを表示
              </button>
            )}
          </>
        )}
        {screen === 'new-place' && (
          <>
            <header className="page-header">
              <div>
                <div className="eyebrow">NEW PLACE</div>
                <h1>場所を登録する。</h1>
              </div>
            </header>
            <PlaceForm
              value={placeDraft}
              onChange={setPlaceDraft}
              onSubmit={savePlace}
              busy={busy}
            />
          </>
        )}
        {screen === 'new-visit' && (
          <>
            <header className="page-header">
              <div>
                <div className="eyebrow">NEW VISIT</div>
                <h1>訪問を記録する。</h1>
              </div>
            </header>
            <VisitForm
              value={visitDraft}
              onChange={setVisitDraft}
              onSubmit={saveVisit}
              places={places}
              busy={busy}
              files={files}
              onFiles={setFiles}
            />
          </>
        )}
        {selectedVisit && (
          <section className="detail-panel" aria-label="訪問の詳細">
            <div className="section-heading">
              <h2>
                {placeName(selectedVisit.placeId)} · {localDate(selectedVisit.visitedAt)}
              </h2>
              <button className="secondary-button" onClick={() => setSelectedVisit(null)}>
                閉じる
              </button>
            </div>
            <p>{selectedVisit.text || '感想はありません'}</p>
            <div className="action-row">
              <button className="secondary-button" onClick={startVisitEdit}>
                訪問を編集
              </button>
              <button className="danger-button" onClick={removeVisit} disabled={busy}>
                訪問を削除
              </button>
            </div>
            {editingVisit && (
              <VisitForm
                value={visitDraft}
                onChange={setVisitDraft}
                onSubmit={saveVisit}
                places={places}
                busy={busy}
                editing
                files={files}
                onFiles={setFiles}
              />
            )}
            <div className="section-heading">
              <h2>写真 ({selectedVisit.photos?.length ?? 0}/20)</h2>
            </div>
            <form
              className="photo-upload"
              onSubmit={(event) => {
                event.preventDefault()
                run(() => upload(selectedVisit.id, files))
              }}
            >
              <label>
                写真を追加（1回10枚まで）
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                />
              </label>
              <button className="primary-button" disabled={busy || !files.length}>
                写真を保存
              </button>
            </form>
            <div className="photo-grid">
              {selectedVisit.photos?.map((photo) => (
                <figure key={photo.id}>
                  <a href={photo.originalUrl} target="_blank" rel="noreferrer">
                    <img src={photo.thumbnailUrl} alt={photo.caption ?? photo.originalFilename} />
                  </a>
                  <figcaption>{photo.originalFilename}</figcaption>
                  <div className="action-row">
                    <button onClick={() => movePhoto(photo, -1)} disabled={busy}>
                      前へ
                    </button>
                    <button onClick={() => movePhoto(photo, 1)} disabled={busy}>
                      後へ
                    </button>
                    <button
                      className="danger-button"
                      onClick={() => removePhoto(photo)}
                      disabled={busy}
                    >
                      削除
                    </button>
                  </div>
                </figure>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

type PlaceDraft = {
  name: string
  category: string
  latitude: string
  longitude: string
  address: string
  note: string
}
function PlaceForm({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: PlaceDraft
  onChange: (value: PlaceDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  busy: boolean
}) {
  const field =
    (key: keyof PlaceDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...value, [key]: event.target.value })
  return (
    <form className="draft-form" onSubmit={onSubmit}>
      <label>
        場所名
        <input required maxLength={200} value={value.name} onChange={field('name')} />
      </label>
      <label>
        カテゴリ
        <input maxLength={80} value={value.category} onChange={field('category')} />
      </label>
      <div className="field-pair">
        <label>
          緯度
          <input
            required
            type="number"
            min="-90"
            max="90"
            step="0.000001"
            value={value.latitude}
            onChange={field('latitude')}
          />
        </label>
        <label>
          経度
          <input
            required
            type="number"
            min="-180"
            max="180"
            step="0.000001"
            value={value.longitude}
            onChange={field('longitude')}
          />
        </label>
      </div>
      <label>
        住所
        <input value={value.address} onChange={field('address')} />
      </label>
      <label>
        メモ
        <textarea rows={3} value={value.note} onChange={field('note')} />
      </label>
      <button className="primary-button" disabled={busy}>
        場所を保存
      </button>
    </form>
  )
}

type VisitDraft = { placeId: string; visitedAt: string; text: string }
function VisitForm({
  value,
  onChange,
  onSubmit,
  places,
  busy,
  editing = false,
  files,
  onFiles,
}: {
  value: VisitDraft
  onChange: (value: VisitDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  places: Place[]
  busy: boolean
  editing?: boolean
  files: File[]
  onFiles: (files: File[]) => void
}) {
  return (
    <form className="draft-form" onSubmit={onSubmit}>
      <label>
        訪れた場所
        <select
          required
          value={value.placeId}
          disabled={editing}
          onChange={(event) => onChange({ ...value, placeId: event.target.value })}
        >
          <option value="">選択してください</option>
          {places.map((place) => (
            <option value={place.id} key={place.id}>
              {place.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        訪問日時
        <input
          required
          type="datetime-local"
          value={value.visitedAt}
          onChange={(event) => onChange({ ...value, visitedAt: event.target.value })}
        />
      </label>
      <label>
        感想
        <textarea
          maxLength={10000}
          rows={5}
          value={value.text}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
      </label>
      <label>
        写真（任意・10枚まで）
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      {files.length > 0 && <p>{files.length}枚を選択中</p>}
      <button className="primary-button" disabled={busy || (!editing && !places.length)}>
        訪問を保存
      </button>
    </form>
  )
}
