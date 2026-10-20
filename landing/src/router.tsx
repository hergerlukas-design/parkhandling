import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { BookingPage } from './pages/BookingPage'
import { LegalPage } from './pages/LegalPage'
import { LegalTextPage } from './pages/LegalTextPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ThanksPage } from './pages/ThanksPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/anfrage', element: <BookingPage /> },
      { path: '/danke', element: <ThanksPage /> },
      { path: '/agb', element: <LegalTextPage kind="agb" /> },
      { path: '/widerruf', element: <LegalTextPage kind="widerruf" /> },
      { path: '/impressum', element: <LegalPage kind="impressum" /> },
      { path: '/datenschutz', element: <LegalPage kind="datenschutz" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
