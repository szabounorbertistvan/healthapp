/**
 * DishFinder's chef-hat mark (client/public/dishfinder-icon.svg in that repo),
 * inlined in currentColor so it follows the theme. Sits in front of every link
 * that opens DishFinder, so the person knows they are leaving Voinic.
 */
export function DishFinderMark({ className = "h-[14px] w-[14px] shrink-0" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
      <path d="M6 17h12" />
    </svg>
  );
}
