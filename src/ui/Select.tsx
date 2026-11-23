import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { inputClass } from "@/ui/fields";

/**
 * Menu déroulant : la flèche native est masquée et remplacée par un chevron éloigné du bord (12 px),
 * avec une marge à droite pour que le texte ne passe jamais dessous.
 */
export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative w-full ${className}`}>
      <select {...props} className={`${inputClass} cursor-pointer appearance-none pr-10 disabled:cursor-not-allowed disabled:opacity-50`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}
