const navigationMenu = document.getElementById('navLinks');
const navigationToggle = document.getElementById('menuToggle');
const navigationHeader = navigationToggle?.closest('.navbar');

function isMobileNavigation() {
  return window.matchMedia('(max-width: 991px)').matches;
}

function setNavigationToggleState(isOpen) {
  if (!navigationToggle) return;
  navigationToggle.setAttribute('aria-expanded', String(isOpen));
  navigationToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  const icon = navigationToggle.querySelector('.menu-toggle-icon');
  const label = navigationToggle.querySelector('.menu-toggle-label');
  if (icon) icon.textContent = isOpen ? '✕' : '☰';
  if (label) label.textContent = isOpen ? 'Close' : 'Menu';
}

function closeNavigationMenu() {
  navigationMenu?.classList.remove('open');
  navigationMenu?.querySelectorAll('.dropdown.open').forEach((dropdown) => {
    dropdown.classList.remove('open');
    dropdown.querySelector(':scope > a[aria-haspopup="true"]')?.setAttribute('aria-expanded', 'false');
  });
  setNavigationToggleState(false);
}

navigationToggle?.addEventListener('click', () => {
  if (!navigationMenu) return;
  const isOpen = navigationMenu.classList.toggle('open');
  if (!isOpen) {
    closeNavigationMenu();
    return;
  }
  setNavigationToggleState(true);
});

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

  if (isMobileNavigation()) closeNavigationMenu();
});

document.addEventListener('click', (event) => {
  if (isMobileNavigation() && navigationMenu?.classList.contains('open') && !navigationHeader?.contains(event.target)) {
    closeNavigationMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navigationMenu?.classList.contains('open')) {
    closeNavigationMenu();
    navigationToggle?.focus();
  }
});

window.addEventListener('resize', () => {
  if (!isMobileNavigation()) closeNavigationMenu();
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.error || `The request failed (${response.status}).`);
  }
}

// 1. Handle "Register Now" Submission
document.getElementById('registerForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const payload = {
    first_name: document.getElementById('firstName').value,
    last_name: document.getElementById('lastName').value,
    email: document.getElementById('regEmail').value,
    phone: document.getElementById('regPhone').value,
    course: document.getElementById('selectCourse').value,
    current_status: document.getElementById('selectStatus').value
  };

  if (submitButton) submitButton.disabled = true;
  try {
    await postFormSubmission('/api/register', payload);
    form.reset();
    showSubmissionConfirmation();
  } catch (error) {
    alert(`Failed to register: ${error.message}`);
  } finally {
    if (submitButton) submitButton.disabled = false;
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
  const certificateId = typeof certId === 'string' ? certId.trim() : '';
  if (!resultBox) return;
  if (!certificateId) {
    resultBox.textContent = 'Enter a certificate number to begin verification.';
    return;
  }

  resultBox.textContent = 'Checking certificate against the official registry...';
  try {
    const res = await fetch(`/api/verify/${encodeURIComponent(certificateId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 404) throw new Error(data.error || 'The verification service is unavailable.');

    const card = document.createElement('article');
    card.className = data.valid ? 'verification-result-card valid' : 'verification-result-card invalid';
    const heading = document.createElement('h3');
    heading.textContent = data.valid ? 'Authentic Certificate Verified' : 'Certificate Not Verified';
    card.appendChild(heading);

    if (data.valid && data.certificate) {
      const { certificate } = data;
      const issueDate = certificate.issue_date ? new Date(certificate.issue_date) : null;
      const formattedDate = !issueDate || Number.isNaN(issueDate.getTime())
        ? certificate.issue_date || 'Not available'
        : issueDate.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
      const fields = [
        ['Certificate ID', certificate.certificate_id],
        ['Student Name', certificate.student_name],
        ['Course / Internship Track', certificate.course_name],
        ['Issue Date', formattedDate],
        ['Issuing Authority', 'SK SMART AI TECHNOLOGIES'],
        ['Verification Status', 'Verified in the official credential registry']
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
  const trimmed = decodedText.trim();
  try {
    const url = new URL(trimmed);
    const certParam = url.searchParams.get('cert');
    if (certParam) return certParam.trim().toUpperCase();
  } catch {
    // QR contents that are not URLs are certificate IDs.
  }
  return trimmed.toUpperCase();
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
  const scannedCertId = params.get('cert');
  if (scannedCertId) {
    if (window.location.pathname.toLowerCase().endsWith('/training.html')) {
      const redirectUrl = new URL(window.location.href);
      redirectUrl.pathname = redirectUrl.pathname.replace(/training\.html$/i, 'verify.html');
      window.location.replace(redirectUrl.toString());
      return;
    }
    const input = document.getElementById('certInput');
    if (input) input.value = scannedCertId;
    document.getElementById('verifySection')?.scrollIntoView({ behavior: 'smooth' });
    verifyCertificate(scannedCertId);
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

let chatRequestInProgress = false;

function ensureChatbotWidget() {
  if (document.getElementById('chatbotToggleBtn')) return;
  const widget = document.createElement('div');
  widget.className = 'chatbot-widget';
  widget.innerHTML = `
    <button class="chatbot-toggle-btn" id="chatbotToggleBtn" type="button" aria-label="Open chat" aria-expanded="false">
      <i class="fas fa-robot"></i>
    </button>
    <div class="chatbot-window glass" id="chatbotWindow">
      <div class="chatbot-header">
        <div class="bot-info"><i class="fas fa-robot"></i><div><h4>SK AI Assistant</h4><span>SK SMART AI TECHNOLOGIES</span></div></div>
        <button class="close-bot" id="closeBotBtn" type="button" aria-label="Close chat"><i class="fas fa-times"></i></button>
      </div>
      <div class="chatbot-messages" id="chatbotMessages" aria-live="polite"></div>
      <div class="chatbot-input-area">
        <input type="text" id="chatUserInput" placeholder="Choose an option or type a question..." onkeypress="handleChatKeyPress(event)" aria-label="Type your message">
        <button type="button" onclick="sendChatMessage()" aria-label="Send message"><i class="fas fa-paper-plane"></i></button>
      </div>
    </div>`;
  document.body.appendChild(widget);
}

function appendChatMessage(text, className) {
  const messages = document.getElementById('chatbotMessages');
  if (!messages) return;
  const message = document.createElement('div');
  message.className = `message ${className}`;
  message.textContent = text;
  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;
}

function renderChatOptions(options) {
  const messages = document.getElementById('chatbotMessages');
  if (!messages) return;
  messages.querySelector('.chatbot-options')?.remove();
  if (!Array.isArray(options)) return;

  const validOptions = options.filter((option) => typeof option === 'string' && option.trim());
  if (!validOptions.length) return;
  const optionList = document.createElement('div');
  optionList.className = 'chatbot-options';
  validOptions.forEach((option) => {
    const button = document.createElement('button');
    button.className = 'chatbot-option';
    button.type = 'button';
    button.textContent = option;
    button.addEventListener('click', () => sendChatMessage(option));
    optionList.appendChild(button);
  });
  messages.appendChild(optionList);
  messages.scrollTop = messages.scrollHeight;
}

function localAssistantFallback(message) {
  const normalized = message.toLocaleLowerCase();
  if (/certificate|verify|verification/.test(normalized)) {
    return 'Use the certificate verification page to enter or scan the certificate ID against the official registry.';
  }
  if (/internship|workshop|bootcamp|placement/.test(normalized)) {
    return 'We offer hands-on 1-, 3- and 6-month internships, live workshops, bootcamps, project mentoring, and placement support. Contact us for the next batch schedule.';
  }
  if (/course|training|learn|class/.test(normalized)) {
    return `Our courses include ${['Artificial Intelligence', 'Machine Learning', 'Data Science', 'Data Analytics', 'Full Stack Development', 'Generative AI', 'Web Design'].join(', ')}. Contact us for current batches.`;
  }
  if (/solution|service|enterprise|software|cloud|automation|website|mobile app/.test(normalized)) {
    return 'We deliver web and mobile applications, enterprise software, cloud platforms, applied AI, workflow automation, and analytics solutions.';
  }
  if (/contact|phone|call|email|whatsapp/.test(normalized)) {
    return 'Contact SK SMART AI TECHNOLOGIES at +91 93614 83073 or sksmartaitechnologies@gmail.com.';
  }
  return 'SK SMART AI TECHNOLOGIES can help with courses, IT solutions, internships and workshops, certificate verification, and contacting our team.';
}

async function sendChatMessage(suggestedMessage) {
  const input = document.getElementById('chatUserInput');
  const message = typeof suggestedMessage === 'string'
    ? suggestedMessage.trim()
    : input?.value.trim();
  if (!message || chatRequestInProgress) return;

  const sendButton = document.querySelector('.chatbot-input-area button');
  chatRequestInProgress = true;
  if (input) input.value = '';
  if (sendButton) sendButton.disabled = true;
  appendChatMessage(message, 'user-message');
  renderChatOptions([]);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9500);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || typeof data.reply !== 'string' || !data.reply.trim()) {
      throw new Error(data.error || 'The assistant returned an invalid response.');
    }
    appendChatMessage(data.reply, 'bot-message');
    if (data.action === 'verify_certificate') {
      const link = document.createElement('a');
      link.className = 'chatbot-action-link';
      link.href = 'verify.html';
      link.textContent = 'Open certificate verification';
      document.getElementById('chatbotMessages')?.appendChild(link);
    }
    renderChatOptions(data.options);
  } catch (error) {
    console.warn('Chat assistant request failed; showing the built-in response:', error);
    appendChatMessage(localAssistantFallback(message), 'bot-message');
    renderChatOptions(['Courses', 'IT solutions', 'Internships and workshops', 'Verify a certificate', 'Contact']);
  } finally {
    window.clearTimeout(timeout);
    chatRequestInProgress = false;
    if (sendButton) sendButton.disabled = false;
    input?.focus();
  }
}

function handleChatKeyPress(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendChatMessage();
  }
}

window.sendChatMessage = sendChatMessage;
window.handleChatKeyPress = handleChatKeyPress;

function initializeChatbot() {
  ensureChatbotWidget();
  const toggle = document.getElementById('chatbotToggleBtn');
  const chatWindow = document.getElementById('chatbotWindow');
  const closeButton = document.getElementById('closeBotBtn');
  if (!toggle || !chatWindow || toggle.dataset.chatInitialized) return;

  toggle.dataset.chatInitialized = 'true';
  toggle.addEventListener('click', () => {
    const isOpen = chatWindow.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close chat' : 'Open chat');
    const messages = document.getElementById('chatbotMessages');
    if (isOpen && messages && !messages.dataset.greeted) {
      messages.dataset.greeted = 'true';
      appendChatMessage('Hello! How can I help with SK SMART AI TECHNOLOGIES today?', 'bot-message');
      renderChatOptions(['Courses', 'IT solutions', 'Internships and workshops', 'Verify a certificate', 'Contact']);
    }
    if (isOpen) document.getElementById('chatUserInput')?.focus();
  });
  closeButton?.addEventListener('click', () => {
    chatWindow.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open chat');
  });
}

initializeChatbot();