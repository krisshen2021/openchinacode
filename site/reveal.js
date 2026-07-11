// Scroll reveal fallback for browsers without CSS animation-timeline: view() support
if (!CSS.supports('animation-timeline', 'view()')) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -100px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}
