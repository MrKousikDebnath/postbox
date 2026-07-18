export interface Theme {
  id: string
  name: string
  /** simplified gradient for the picker swatch (full styling lives in styles.css) */
  swatchBg: string
  accent: string
  dark: boolean
}

export const THEMES: Theme[] = [
  {
    id: 'aurora',
    name: 'Aurora Glass',
    swatchBg: 'linear-gradient(135deg, #1a1040, #0e2340, #0a3335)',
    accent: '#ff6c37',
    dark: true
  },
  {
    id: 'frost',
    name: 'Frost Light',
    swatchBg: 'linear-gradient(120deg, #dfe9f3, #ffffff 45%, #ffe8dc)',
    accent: '#e55420',
    dark: false
  },
  {
    id: 'carbon',
    name: 'Carbon Neon',
    swatchBg: 'linear-gradient(135deg, #101114, #16171c)',
    accent: '#ff6c37',
    dark: true
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    swatchBg: 'linear-gradient(135deg, #2b1055, #7b2a6b 60%, #ff2e97)',
    accent: '#ff2e97',
    dark: true
  },
  {
    id: 'matrix',
    name: 'Matrix',
    swatchBg: 'linear-gradient(135deg, #020806, #04140c)',
    accent: '#3ad16b',
    dark: true
  },
  {
    id: 'tron',
    name: 'Tron Ice',
    swatchBg: 'linear-gradient(135deg, #041016, #06222e 60%, #0a3a4a)',
    accent: '#22d3ee',
    dark: true
  },
  {
    id: 'nebula',
    name: 'Nebula',
    swatchBg: 'linear-gradient(135deg, #1b0b2e, #3d1a5b 55%, #b06cff)',
    accent: '#b06cff',
    dark: true
  }
]

export const DEFAULT_THEME = 'aurora'

export function applyTheme(id: string): void {
  document.documentElement.dataset.theme = id
  localStorage.setItem('theme', id)
}

export function loadTheme(): string {
  const saved = localStorage.getItem('theme')
  const id = saved && THEMES.some((t) => t.id === saved) ? saved : DEFAULT_THEME
  document.documentElement.dataset.theme = id
  return id
}
