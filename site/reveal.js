const reveals = document.querySelectorAll('.reveal');

requestAnimationFrame(() => {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      } else {
        entry.target.classList.remove('is-visible');
      }
    });
  }, { rootMargin: '-50px 0px -50px 0px' });
  reveals.forEach(el => observer.observe(el));
});
