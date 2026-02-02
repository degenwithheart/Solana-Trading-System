import UnlockForm from "./unlock-form";

export default function UnlockPage({ searchParams }: { searchParams?: { next?: string } }) {
  return <UnlockForm nextPath={searchParams?.next ?? "/"} />;
}

