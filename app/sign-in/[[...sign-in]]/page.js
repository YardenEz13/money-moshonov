import { SignIn } from "@clerk/nextjs";
export default function Page() {
  return (
    <main className="flex-1 grid place-items-center p-6 bg-bg">
      <SignIn />
    </main>
  );
}
