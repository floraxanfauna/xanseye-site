import "./minis.css";

/** Everything under the booking pages is wrapped in .xm so its styles never touch the rest of xanseye.com. */
export default function MinisLayout({ children }: { children: React.ReactNode }) {
  return <div className="xm" style={{ minHeight: "100vh" }}>{children}</div>;
}
