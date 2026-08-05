import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui ile uyumlu className birleştirici. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}