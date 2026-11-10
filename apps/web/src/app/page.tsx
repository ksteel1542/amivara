export default function HomePage() {
  return (
    <main>
      <header className="hero">
        <span className="hero__mark" aria-hidden="true" />
        <div className="hero__wordmark" role="img" aria-label="AMIVARA">
          AMIVARA
        </div>
      </header>

      <section className="content">
        <h1>Real connections between verified adults.</h1>
        <ul className="props">
          <li>Every member is 18+ and identity-verified</li>
          <li>You only chat when it&apos;s mutual</li>
          <li>Your exact location is never shown</li>
        </ul>
        <a className="cta" href="#get-the-app">
          Get AMIVARA on Android
        </a>
        <p className="legal">AMIVARA is for adults aged 18 and over. Launching first in Lagos and Abuja.</p>
      </section>
    </main>
  );
}
