function ready(e){"loading"!=document.readyState?e():document.addEventListener("DOMContentLoaded",e)}var simple_persistence={};Storage.prototype.setObject=function(e,t){this.setItem(e,JSON.stringify(t))},Storage.prototype.getObject=function(e){var t=this.getItem(e);return t&&JSON.parse(t)},window.addEventListener("beforeunload",function(){Array.prototype.slice.call(document.querySelectorAll("[data-persist-key]")).forEach(function(e){simple_persistence[e.dataset.persistKey]=Array.prototype.slice.call(e.classList)}),localStorage.setObject("simple_persistence",simple_persistence)}),ready(function(){if("object"==typeof localStorage)try{localStorage.setItem("localStorage",1),localStorage.removeItem("localStorage")}catch(e){return Storage.prototype._setItem=Storage.prototype.setItem,Storage.prototype.setItem=function(){},void console.error('Your web browser does not support storing settings locally. In Safari, the most common cause of this is using "Private Browsing Mode". Some settings may not save or some features may not work properly for you.')}var e=Array.prototype.slice.call(document.querySelectorAll("[data-persist-key]")),t=localStorage.getObject("simple_persistence");e.forEach(function(e){if(e.dataset.persistKey&&t){var o=t[e.dataset.persistKey];e.setAttribute("class",""),o.forEach(function(t){e.classList.add(t)})}})});