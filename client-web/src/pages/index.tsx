import Link from "next/link";

export default function Home() {
  return (
    <div>
      <Link href="/stock/us">View US Stocks</Link>
      <br />
      <Link href="/stock/tr">View TR Stocks</Link>
      <br />
      <Link href="/cumulative-yields">Cumulative Yields</Link>
      <br />
      <Link href="/yoy-yields">YoY Yields</Link>
    </div>
  );
}
