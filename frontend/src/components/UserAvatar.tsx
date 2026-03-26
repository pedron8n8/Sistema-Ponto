type UserAvatarProps = {
  name?: string | null
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeByVariant: Record<NonNullable<UserAvatarProps['size']>, string> = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-20 w-20 text-xl',
}

const pickInitial = (name?: string | null) => {
  const trimmed = (name || '').trim()
  if (!trimmed) return '?'
  return trimmed.charAt(0).toUpperCase()
}

const UserAvatar = ({ name, photoUrl, size = 'md', className = '' }: UserAvatarProps) => {
  const initials = pickInitial(name)
  const sizeClass = sizeByVariant[size]

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`Foto de ${name || 'usuário'}`}
        className={`${sizeClass} rounded-full border border-slate-200 object-cover ${className}`.trim()}
        loading="lazy"
      />
    )
  }

  return (
    <div
      className={`${sizeClass} flex items-center justify-center rounded-full border border-slate-200 bg-slate-100 font-semibold text-slate-600 ${className}`.trim()}
      aria-label={`Avatar de ${name || 'usuário'}`}
    >
      {initials}
    </div>
  )
}

export default UserAvatar
