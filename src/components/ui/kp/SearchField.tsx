import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import type { IconType } from './types';
import { IconButton } from './IconButton';

type SearchSize = 'sm' | 'md';

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size' | 'className' | 'type'> {
  value: string;
  onChange: (value: string) => void;
  size?: SearchSize;
  /** Leading icon component (defaults to a magnifier). */
  icon?: IconType;
  /** When provided, a clear (×) button appears while the field has text. */
  onClear?: () => void;
  className?: string;
}

/** The one search input. Focus highlights the whole field via a navy border. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, size = 'md', icon: Icon = Search, onClear, placeholder, className, ...rest },
  ref,
) {
  const wrapClasses = ['kp-search', `kp-search--${size}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={wrapClasses}>
      <span className="kp-search__icon">
        <Icon size={14} strokeWidth={1.75} />
      </span>
      <input
        ref={ref}
        className="kp-search__input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...rest}
      />
      {onClear && value ? (
        <IconButton icon={X} label="Clear search" size="xs" variant="ghost" onClick={onClear} />
      ) : null}
    </div>
  );
});
SearchField.displayName = 'SearchField';
