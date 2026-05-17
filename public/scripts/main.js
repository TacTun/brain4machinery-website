/* ============================================
   TACTUN brain4machinery.com — Main JS
   Sticky nav, hamburger, scroll animations, form
   ============================================ */

(function () {
  'use strict';

  // --- Sticky Nav ---
  const nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', function () {
      nav.classList.toggle('nav--scrolled', window.scrollY > 10);
    }, { passive: true });
  }

  // --- Hamburger Menu ---
  const hamburger = document.querySelector('.nav__hamburger');
  const mobileMenu = document.querySelector('.nav__mobile');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function () {
      const isOpen = hamburger.classList.toggle('nav__hamburger--open');
      mobileMenu.classList.toggle('nav__mobile--open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    mobileMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        hamburger.classList.remove('nav__hamburger--open');
        mobileMenu.classList.remove('nav__mobile--open');
        document.body.style.overflow = '';
      });
    });
  }

  // --- Scroll Animations ---
  var fadeEls = document.querySelectorAll('.fade-in');
  if (fadeEls.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('fade-in--visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    fadeEls.forEach(function (el) { observer.observe(el); });
  } else {
    fadeEls.forEach(function (el) { el.classList.add('fade-in--visible'); });
  }

  // --- Contact Form ---
  var form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('.form__submit');
      var status = document.getElementById('form-status');
      var data = new FormData(form);

      btn.disabled = true;
      btn.textContent = 'Sending...';

      fetch('/api/contact', {
        method: 'POST',
        body: data
      })
        .then(function (res) { return res.json(); })
        .then(function (result) {
          if (result.success) {
            status.className = 'form__status form__status--success';
            status.textContent = "Message sent! We'll be in touch shortly.";
            form.reset();
          } else {
            status.className = 'form__status form__status--error';
            status.textContent = result.message || 'Something went wrong. Please try again.';
          }
        })
        .catch(function () {
          status.className = 'form__status form__status--error';
          status.textContent = 'Network error. Please email us at contact@tactun.com';
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Send Message';
        });
    });
  }
})();
