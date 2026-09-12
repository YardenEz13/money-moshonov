import { SignUp } from "@clerk/nextjs";
export default function Page() {
  return (
    <main className="flex-1 grid place-items-center p-6 bg-paper">
      <SignUp />
    </main>
  );
}
