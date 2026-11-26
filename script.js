const navigationMenu = document.getElementById('navLinks');

function isMobileNavigation() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function closeNavigationDropdowns() {
  navigationMenu?.querySelectorAll('.dropdown.open').forEach((dropdown) => {
    dropdown.classList.remove('open');
    dropdown.querySelector(':scope > a[aria-haspopup="true"]')?.setAttribute('aria-expanded', 'false');
  });
}

navigationMenu?.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link || !navigationMenu.contains(link)) return;

  const dropdownToggle = link.matches('[aria-haspopup="true"]') ? link : null;
  if (dropdownToggle && isMobileNavigation()) {
    event.preventDefault();
    const dropdown = dropdownToggle.closest('.dropdown');
    if (!dropdown) return;
    const isOpen = dropdown.classList.toggle('open');
    dropdownToggle.setAttribute('aria-expanded', String(isOpen));
    navigationMenu.querySelectorAll('.dropdown.open').forEach((otherDropdown) => {
      if (otherDropdown === dropdown) return;
      otherDropdown.classList.remove('open');
      otherDropdown.querySelector(':scope > a[aria-haspopup="true"]')?.setAttribute('aria-expanded', 'false');
    });
    return;
  }

  if (isMobileNavigation()) closeNavigationDropdowns();
});

document.addEventListener('click', (event) => {
  if (isMobileNavigation() && navigationMenu?.querySelector('.dropdown.open') && !navigationMenu.contains(event.target)) {
    closeNavigationDropdowns();
  }

  const menuControl = document.querySelector('.menu-control');
  const menuToggle = event.target instanceof Element ? event.target.closest('.menu-toggle') : null;
  if (menuToggle && menuControl?.contains(menuToggle)) {
    const isOpen = menuControl.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  } else if (menuControl?.classList.contains('open') && !menuControl.contains(event.target)) {
    menuControl.classList.remove('open');
    menuControl.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navigationMenu?.querySelector('.dropdown.open')) {
    const dropdownToggle = navigationMenu.querySelector('.dropdown.open > a[aria-haspopup="true"]');
    closeNavigationDropdowns();
    dropdownToggle?.focus();
  }

  if (event.key === 'Escape') {
    const menuControl = document.querySelector('.menu-control.open');
    if (menuControl) {
      menuControl.classList.remove('open');
      const menuToggle = menuControl.querySelector('.menu-toggle');
      menuToggle?.setAttribute('aria-expanded', 'false');
      menuToggle?.focus();
    }
  }
});

window.addEventListener('resize', () => {
  if (!isMobileNavigation()) closeNavigationDropdowns();
});

let submissionConfirmationTimer;

function closeSubmissionConfirmation() {
  const overlay = document.getElementById('submissionConfirmation');
  if (overlay) overlay.classList.remove('open');
  window.clearTimeout(submissionConfirmationTimer);
}

function showSubmissionConfirmation() {
  let overlay = document.getElementById('submissionConfirmation');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'submissionConfirmation';
    overlay.className = 'modal-overlay submission-confirmation-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'submissionConfirmationTitle');

    const dialog = document.createElement('div');
    dialog.className = 'modal-content submission-confirmation-content';
    const icon = document.createElement('span');
    icon.className = 'submission-confirmation-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✓';
    const title = document.createElement('h2');
    title.id = 'submissionConfirmationTitle';
    title.textContent = 'Submission received';
    const message = document.createElement('p');
    message.textContent = 'Thank you! Our team will contact you shortly.';
    const closeButton = document.createElement('button');
    closeButton.className = 'btn btn-primary';
    closeButton.type = 'button';
    closeButton.textContent = 'OK';
    closeButton.addEventListener('click', closeSubmissionConfirmation);
    dialog.append(icon, title, message, closeButton);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeSubmissionConfirmation();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('open')) {
        closeSubmissionConfirmation();
      }
    });
    document.body.appendChild(overlay);
  }

  window.clearTimeout(submissionConfirmationTimer);
  overlay.classList.add('open');
  overlay.querySelector('button')?.focus();
  submissionConfirmationTimer = window.setTimeout(closeSubmissionConfirmation, 7000);
}

async function postFormSubmission(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const responseSnippet = (await response.text()).slice(0, 300);
    console.error(`Expected JSON from ${endpoint}; received HTTP ${response.status}: ${responseSnippet}`);
    throw new Error(`The server returned an unexpected response (${response.status}).`);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    console.error(`Invalid JSON from ${endpoint} (HTTP ${response.status}).`, error);
    throw new Error(`The server returned invalid JSON (${response.status}).`);
  }
  if (!response.ok || data.success !== true) {
    throw new Error(data.error || `The request failed (${response.status}).`);
  }
}

// 1. Handle "Register Now" Submission
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('#registerForm.register-form')) return;
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  let status = form.querySelector('.register-form-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'register-form-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    submitButton?.before(status);
  }
  status.textContent = '';
  const payload = {
    firstName: form.elements.namedItem('firstName')?.value,
    lastName: form.elements.namedItem('lastName')?.value,
    email: form.elements.namedItem('email')?.value,
    phone: form.elements.namedItem('phone')?.value,
    course: form.elements.namedItem('course')?.value,
    status: form.elements.namedItem('status')?.value
  };

  const submitLabel = submitButton?.textContent;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
  }
  try {
    await postFormSubmission('/api/register', payload);
    form.reset();
    closeModal('registerModal');
    showSubmissionConfirmation();
  } catch (error) {
    status.textContent = error.message || 'Unable to submit your registration. Please try again.';
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitLabel;
    }
  }
});

// 2. Handle "Send Us a Message" Submission
document.getElementById('enquiryForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('contactFormStatus');
  const submitButton = form.querySelector('button[type="submit"]');
  const subject = document.getElementById('enqSubject')?.value;
  const message = document.getElementById('enqMessage').value;
  const payload = {
    full_name: document.getElementById('enqName').value,
    email: document.getElementById('enqEmail').value,
    phone: document.getElementById('enqPhone').value,
    message: subject ? `Subject: ${subject}\n\n${message}` : message
  };

  if (status) status.textContent = 'Sending your message...';
  if (submitButton) submitButton.disabled = true;
  try {
    await postFormSubmission('/api/enquiry', payload);
    form.reset();
    if (status) status.textContent = 'Thank you! Our team will contact you shortly.';
    showSubmissionConfirmation();
  } catch (error) {
    if (status) status.textContent = error.message || 'Unable to send your message. Please try again.';
    else alert(`Failed to send message: ${error.message}`);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

// 3. Certificate Verification Function (Used by Search & QR Scan)
async function verifyCertificate(certId) {
  const resultBox = document.getElementById('verifyResult');
  const certificateId = extractCertIdFromQr(certId);
  const certInput = document.getElementById('certInput');
  if (!resultBox) return;
  if (!certificateId) {
    resultBox.textContent = 'Enter a certificate number to begin verification.';
    return;
  }

  if (certInput) certInput.value = certificateId;
  resultBox.textContent = 'Checking certificate against the official registry...';
  try {
    const res = await fetch(`/api/verify/${encodeURIComponent(certificateId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 404) throw new Error(data.error || 'The verification service is unavailable.');

    const card = document.createElement('article');
    card.className = data.verified ? 'verification-result-card valid' : 'verification-result-card invalid';
    const heading = document.createElement('h3');
    heading.textContent = data.verified ? 'Verified' : 'Certificate Not Verified';
    card.appendChild(heading);

    if (data.verified) {
      const fields = [
        ['Name', data.name],
        ['Certificate Number', data.certificate_number],
        ['Date', data.date]
      ];
      const list = document.createElement('dl');
      fields.forEach(([label, value]) => {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value == null ? 'Not available' : String(value);
        row.append(term, description);
        list.appendChild(row);
      });
      card.appendChild(list);
    } else {
      const message = document.createElement('p');
      message.textContent = `No matching record was found for "${certificateId}". The credential may be invalid, tampered with, or the ID may contain a typo.`;
      card.appendChild(message);
      const contactLink = document.createElement('a');
      contactLink.href = 'contact.html';
      contactLink.textContent = 'Contact the issuer for assistance.';
      card.appendChild(contactLink);
    }

    resultBox.replaceChildren(card);
  } catch (error) {
    resultBox.textContent = error.message || 'The verification service is unavailable. Please try again later.';
  }
}

// Button click for manual certificate search
document.getElementById('verifyBtn')?.addEventListener('click', () => {
  const id = document.getElementById('certInput')?.value;
  verifyCertificate(id);
});

document.getElementById('sampleCertBtn')?.addEventListener('click', () => {
  const input = document.getElementById('certInput');
  if (input) {
    input.value = 'SKAI-2026-001';
    input.focus();
  }
});

function extractCertIdFromQr(decodedText) {
  if (typeof decodedText !== 'string' || !decodedText.trim()) return '';
  const trimmed = decodedText.trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    if (!/[/?]/.test(trimmed)) return trimmed;
    try {
      url = new URL(trimmed, window.location.origin);
    } catch {
      return trimmed;
    }
  }

  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === 'id' && value.trim()) return value.trim();
  }
  const pathSegments = url.pathname.split('/').filter(Boolean);
  return pathSegments.length ? pathSegments[pathSegments.length - 1] : '';
}

let html5QrCodeInstance = null;
let cameraScanHandled = false;

function setQrScannerStatus(message) {
  const statusEl = document.getElementById('qrStatus');
  if (statusEl) statusEl.textContent = message;
}

function setQrCameraControls(isActive) {
  const qrReaderEl = document.getElementById('qrReader');
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  const imageInput = document.getElementById('qrImageInput');
  if (qrReaderEl) qrReaderEl.hidden = !isActive;
  if (startBtn) startBtn.hidden = isActive;
  if (stopBtn) stopBtn.hidden = !isActive;
  if (imageInput) imageInput.disabled = isActive;
}

async function stopCertificateCamera() {
  if (html5QrCodeInstance) {
    await html5QrCodeInstance.stop();
    html5QrCodeInstance.clear();
    html5QrCodeInstance = null;
  }
  setQrCameraControls(false);
}

function handleQrCertificate(decodedText, source) {
  const certId = extractCertIdFromQr(decodedText);
  const certInput = document.getElementById('certInput');
  if (!certId || !certInput) {
    setQrScannerStatus('The QR code did not contain a certificate ID.');
    return;
  }

  certInput.value = certId;
  setQrScannerStatus(`${source} detected: ${certId}`);
  verifyCertificate(certId);
}

document.getElementById('startScanBtn')?.addEventListener('click', async () => {
  const qrReaderEl = document.getElementById('qrReader');
  const startBtn = document.getElementById('startScanBtn');
  const imageInput = document.getElementById('qrImageInput');

  if (!qrReaderEl || typeof Html5Qrcode === 'undefined') {
    setQrScannerStatus('The QR scanner library could not be loaded. Refresh the page or upload a QR image.');
    return;
  }
  if (html5QrCodeInstance) {
    setQrScannerStatus('A camera scan is already in progress.');
    return;
  }

  qrReaderEl.hidden = false;
  if (startBtn) startBtn.disabled = true;
  if (imageInput) imageInput.disabled = true;
  setQrScannerStatus('Starting camera... Point it at the certificate QR code.');

  let scanner;
  cameraScanHandled = false;
  try {
    scanner = new Html5Qrcode('qrReader');
    html5QrCodeInstance = scanner;
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      async (decodedText) => {
        if (cameraScanHandled) return;
        cameraScanHandled = true;
        try {
          await stopCertificateCamera();
        } catch (error) {
          console.error('Unable to stop the certificate QR camera after a scan:', error);
          setQrScannerStatus('QR detected. The camera could not be stopped automatically; use Stop Camera to close it.');
        }
        handleQrCertificate(decodedText, 'QR code');
      },
      () => {}
    );
    if (html5QrCodeInstance === scanner) {
      setQrCameraControls(true);
      setQrScannerStatus('Camera active. Point it at the certificate QR code.');
    }
  } catch (error) {
    console.error('Unable to start the certificate QR camera:', error);
    if (scanner) {
      try {
        scanner.clear();
      } catch (cleanupError) {
        console.error('Unable to clear the certificate QR camera preview:', cleanupError);
      }
    }
    if (scanner && html5QrCodeInstance === scanner) html5QrCodeInstance = null;
    setQrCameraControls(false);
    if (startBtn) startBtn.disabled = false;
    setQrScannerStatus('Camera access denied or unavailable. You can upload a QR image instead.');
  }
  if (startBtn) startBtn.disabled = false;
});

document.getElementById('stopScanBtn')?.addEventListener('click', async () => {
  try {
    await stopCertificateCamera();
    setQrScannerStatus('');
  } catch (error) {
    console.error('Unable to stop the certificate QR camera:', error);
    setQrScannerStatus('Unable to stop the camera. Please try again or close this page to end the scan.');
  }
});

document.getElementById('qrImageInput')?.addEventListener('change', async (event) => {
  const fileInput = event.currentTarget;
  const file = fileInput.files?.[0];
  const qrReaderEl = document.getElementById('qrReader');
  if (!file) return;
  if (typeof Html5Qrcode === 'undefined') {
    setQrScannerStatus('The QR scanner library could not be loaded. Refresh the page and try again.');
    fileInput.value = '';
    return;
  }
  if (!qrReaderEl || html5QrCodeInstance) {
    setQrScannerStatus('Stop the active camera scan before uploading a QR image.');
    fileInput.value = '';
    return;
  }

  qrReaderEl.hidden = false;
  setQrScannerStatus('Scanning uploaded QR image...');
  let fileScanner;
  try {
    fileScanner = new Html5Qrcode('qrReader');
    const decodedText = await fileScanner.scanFile(file, true);
    handleQrCertificate(decodedText, 'QR image');
  } catch (error) {
    console.warn('Unable to decode a certificate QR code from the selected image:', error);
    setQrScannerStatus('Could not detect a valid QR code in that image. Try a clearer image with the full code visible.');
  } finally {
    if (fileScanner) {
      try {
        fileScanner.clear();
      } catch (error) {
        console.error('Unable to clear the uploaded QR image preview:', error);
      }
    }
    qrReaderEl.hidden = true;
    fileInput.value = '';
  }
});

// Automatic check when a student scans the QR code on their certificate
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const idParameter = [...params.entries()].find(([key]) => key.toLowerCase() === 'id');
  const scannedCertId = idParameter?.[1] || params.get('cert');
  if (scannedCertId) {
    if (window.location.pathname.toLowerCase().endsWith('/training.html')) {
      const redirectUrl = new URL(window.location.href);
      redirectUrl.pathname = redirectUrl.pathname.replace(/training\.html$/i, 'verify.html');
      window.location.replace(redirectUrl.toString());
      return;
    }
    const certificateId = extractCertIdFromQr(scannedCertId);
    const input = document.getElementById('certInput');
    if (input) input.value = certificateId;
    document.getElementById('verifySection')?.scrollIntoView({ behavior: 'smooth' });
    verifyCertificate(certificateId);
  }
});

document.getElementById('careerForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('careerFormStatus');
  const submitButton = form.querySelector('button[type="submit"]');
  const payload = {
    full_name: document.getElementById('careerName').value,
    email: document.getElementById('careerEmail').value,
    phone: document.getElementById('careerPhone').value,
    role: document.getElementById('careerRole').value,
    experience_level: document.getElementById('careerExp').value,
    portfolio_url: document.getElementById('careerPortfolio').value,
    message: document.getElementById('careerMessage').value
  };

  if (status) status.textContent = 'Submitting your application...';
  if (submitButton) submitButton.disabled = true;
  try {
    await postFormSubmission('/api/careers', payload);
    form.reset();
    if (status) status.textContent = 'Thank you! Our team will contact you shortly.';
    showSubmissionConfirmation();
  } catch (error) {
    if (status) status.textContent = error.message || 'Unable to submit your application. Please try again.';
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

function openRegisterModal(course) {
  const modal = document.getElementById('registerModal');
  if (!modal) return;
  modal.classList.add('open');
  if (course) {
    const courseSelect = document.getElementById('selectCourse');
    if (courseSelect) courseSelect.value = course;
  }
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

document.querySelectorAll('.course-enroll').forEach((button) => {
  button.addEventListener('click', () => openRegisterModal(button.dataset.course));
});

document.querySelectorAll('[data-role]').forEach((button) => {
  button.addEventListener('click', () => {
    const roleSelect = document.getElementById('careerRole');
    if (roleSelect) roleSelect.value = button.dataset.role;
    document.getElementById('career-application')?.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('careerName')?.focus({ preventScroll: true });
  });
});

document.querySelectorAll('[data-career-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    const filter = button.dataset.careerFilter;
    document.querySelectorAll('[data-career-filter]').forEach((filterButton) => {
      filterButton.classList.toggle('active', filterButton === button);
    });
    document.querySelectorAll('.career-card').forEach((card) => {
      const roles = card.dataset.roles.split(' ');
      card.hidden = filter !== 'all' && !roles.includes(filter);
    });
  });
});

document.querySelectorAll('.filter-btn[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    document.querySelectorAll('.filter-btn[data-filter]').forEach((filterButton) => {
      filterButton.classList.toggle('active', filterButton === button);
    });
    document.querySelectorAll('.course-card[data-category]').forEach((card) => {
      card.hidden = filter !== 'all' && card.dataset.category !== filter;
    });
  });
});

document.querySelectorAll('.modal-overlay').forEach((modal) => {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.classList.remove('open');
  });
});

window.addEventListener('DOMContentLoaded', () => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('section, .about-card, .service-card, .course-card, .testimonial-card, .consulting-card, .stat-card, .timeline-step').forEach((item) => item.classList.add('reveal'));
  const revealItems = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
  document.documentElement.classList.add('motion-ready');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => revealObserver.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const counters = document.querySelectorAll('.counter[data-target]');
  const animateCounter = (counter) => {
    const target = Number(counter.dataset.target);
    const duration = reduceMotion ? 0 : 1400;
    const start = performance.now();
    const update = (now) => {
      const progress = duration ? Math.min((now - start) / duration, 1) : 1;
      const value = Math.round(target * (1 - Math.pow(1 - progress, 3)));
      counter.textContent = counter.dataset.format === 'comma' ? value.toLocaleString('en-IN') : String(value);
      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  };
  if ('IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.6 });
    counters.forEach((counter) => counterObserver.observe(counter));
  } else {
    counters.forEach(animateCounter);
  }

  const specialty = document.querySelector('.rotating-specialty');
  if (specialty && !reduceMotion) {
    const specialties = ['Generative AI', 'Data Intelligence', 'Product Engineering', 'Cloud Platforms'];
    let active = 0;
    window.setInterval(() => {
      active = (active + 1) % specialties.length;
      specialty.classList.add('changing');
      window.setTimeout(() => {
        specialty.textContent = specialties[active];
        specialty.classList.remove('changing');
      }, 180);
    }, 2400);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const widget = document.getElementById('chatbotWidget');
  const toggle = document.getElementById('chatbotToggleBtn');
  const popup = document.getElementById('botpressChatPopup');
  const closeButton = document.getElementById('closeChatbotBtn');
  const iframe = document.getElementById('botpressChatFrame');
  if (!widget || !toggle || !popup || !iframe) return;

  const setChatOpen = (isOpen) => {
    popup.hidden = !isOpen;
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close chat' : 'Open chat');
    if (isOpen && iframe.dataset.loaded !== 'true') {
      iframe.src = iframe.dataset.src;
      iframe.dataset.loaded = 'true';
    }
  };

  toggle.addEventListener('click', () => {
    setChatOpen(popup.hidden);
  });
  closeButton?.addEventListener('click', () => setChatOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !popup.hidden) {
      setChatOpen(false);
      toggle.focus();
    }
  });
});
