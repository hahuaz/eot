import Link from "next/link";

export default function Home() {
  return (
    <div>
      <Link href="/all-stock/us">View US Stocks</Link>
      <br />
      <Link href="/all-stock/tr">View TR Stocks</Link>
      <br />
      <Link href="/cummulative-returns">Cummulative Returns</Link>
    </div>
  );
}
