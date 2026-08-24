import Header from './components/Header';
import Footer from './components/Footer';
import SilentFlow from './pages/SilentFlow';

export default function App() {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header />
      <main className="flex-grow">
        <SilentFlow />
      </main>
      <Footer />
    </div>
  );
}
