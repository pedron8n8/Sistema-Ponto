type BrandWordmarkProps = {
  className?: string
  omniClassName?: string
  puntClassName?: string
}

const joinClassNames = (...values: Array<string | undefined>) => values.filter(Boolean).join(' ')

const BrandWordmark = ({ className, omniClassName, puntClassName }: BrandWordmarkProps) => {
  return (
    <span className={joinClassNames('inline-flex items-center font-bold tracking-tight', className)} aria-label="OmniPunt">
      <span className={joinClassNames('text-slate-800', omniClassName)}>
        Omni
      </span>
      <span className={joinClassNames('bg-gradient-to-br from-teal-600 to-sky-500 bg-clip-text text-transparent', puntClassName)}>
        Punt
      </span>
    </span>
  )
}

export default BrandWordmark
