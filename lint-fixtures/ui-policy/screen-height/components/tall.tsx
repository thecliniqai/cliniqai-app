// UI policy fixture (screen-height, enforced since 06-04a): 100vh heights fail; the dvh utilities pass.
export function Tall() {
  return (
    <div>
      <main className="min-h-screen">a</main>
      <section className="md:h-screen">b</section>
      <aside className="max-h-[100vh]">c</aside>
      <div className="min-h-app h-app">d</div>
    </div>
  );
}
