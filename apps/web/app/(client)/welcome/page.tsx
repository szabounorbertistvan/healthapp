import { WelcomeChoice } from "@/components/welcome-choice";
import { PageTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export default async function WelcomePage() {
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageTitle title={t.clientApp.welcome.title} />
      <WelcomeChoice />
    </div>
  );
}
