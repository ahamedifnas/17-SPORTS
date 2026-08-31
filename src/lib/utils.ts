import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
export const DEFAULT_BRANCH_ID = 'main'

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  console.error(error)
  return fallback
}
