import { addFavorite, removeFavorite } from '../lib/favorites'

export default function FavoriteButton({ user, ticker, name, favorites }) {
  if (!user) return null

  const isFav = favorites.has(ticker?.toUpperCase())

  async function toggle() {
    if (isFav) {
      await removeFavorite(user.uid, ticker)
    } else {
      await addFavorite(user.uid, ticker, name)
    }
  }

  return (
    <button
      className={`fav-btn ${isFav ? 'fav-btn--active' : ''}`}
      onClick={toggle}
      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
    >
      <svg width="18" height="18" viewBox="0 0 24 24"
        fill={isFav ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    </button>
  )
}
