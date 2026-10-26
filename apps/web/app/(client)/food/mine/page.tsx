import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { getMyCustomFoods } from "@/lib/client-data";
import { MyFoods } from "@/components/my-foods";
import { NavIcon } from "@/components/client-nav";

/** My foods: the person's own custom foods — edit, delete, or make a new one. */
export default async function MyFoodsPage() {
  const [{ t }, foods] = await Promise.all([getI18n(), getMyCustomFoods()]);
  const m = t.clientApp.myFoods;

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link href="/food" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink">
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.common.nav.nutrition}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{m.title}</h1>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">{m.intro}</p>
      <MyFoods foods={foods} />
    </div>
  );
}
