export type Place = {
  id: string
  name: string
  category: string
  area: string
}

export type Visit = {
  id: string
  placeId: string
  date: string
  note: string
}

// Fictional content only. No personal visit history belongs in this repository.
export const places: Place[] = [
  { id: 'garden-cafe', name: '庭の喫茶室', category: '喫茶', area: '架空市・緑町' },
  { id: 'hill-library', name: '丘の図書室', category: '文化', area: '架空市・丘町' },
  { id: 'river-walk', name: '川辺の遊歩道', category: '公園', area: '架空市・水辺町' },
  { id: 'old-bath', name: '石畳の湯', category: '温泉', area: '架空県・湯町' },
  { id: 'morning-market', name: '朝の市場', category: '市場', area: '架空市・港町' },
  { id: 'glasshouse', name: '温室ギャラリー', category: '文化', area: '架空市・緑町' },
  { id: 'lighthouse', name: '岬の灯台', category: '散策', area: '架空県・岬町' },
]

export const visits: Visit[] = [
  { id: 'v10', placeId: 'hill-library', date: '2026-10-09', note: '窓際でゆっくり本を選んだ。' },
  { id: 'v09', placeId: 'garden-cafe', date: '2026-10-04', note: '前より庭の緑が深くなっていた。' },
  { id: 'v08', placeId: 'river-walk', date: '2026-09-21', note: '夕方の風が気持ちよかった。' },
  { id: 'v07', placeId: 'old-bath', date: '2026-08-16', note: '小さな露天風呂でひと休み。' },
  { id: 'v06', placeId: 'morning-market', date: '2026-07-30', note: '朝から活気があった。' },
  { id: 'v05', placeId: 'garden-cafe', date: '2026-06-18', note: '雨の日の窓辺もよかった。' },
  {
    id: 'v04',
    placeId: 'glasshouse',
    date: '2026-05-05',
    note: '光がガラスにきれいに映っていた。',
  },
  { id: 'v03', placeId: 'lighthouse', date: '2026-03-11', note: '岬の先まで歩いた。' },
  { id: 'v02', placeId: 'river-walk', date: '2026-01-03', note: '冬の川は澄んでいた。' },
  {
    id: 'v01',
    placeId: 'garden-cafe',
    date: '2025-11-23',
    note: '初めて来た日の紅茶を覚えている。',
  },
]

export function visitsForPlace(placeId: string): Visit[] {
  return visits
    .filter((visit) => visit.placeId === placeId)
    .sort((a, b) => b.date.localeCompare(a.date))
}
