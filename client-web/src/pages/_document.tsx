import { Html, Head, Main, NextScript } from "next/document";

import Link from "next/link";
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className="antialiased">
        <div>
          <Link href={`/`} className="text-blue-500 hover:underline">
            home
          </Link>
        </div>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
