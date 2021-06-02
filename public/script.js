// Everything below is getting refactored into Mozart

const output_all_element    = document.getElementById("output-all");

const setAllOutput = (text) => {
  output_all_element.innerHTML = text;
  k$.status({
    text: "Done", type: "status-green"
  })
}

const regenerate_notice = document.getElementById("regenerate-notice");
const setAllNotice = () => {
  regenerate_notice.classList.remove("hide")
}

const generate_all_element = document.getElementById("generate-all");
const permute_all = () => {
  regenerate_notice.classList.remove("notshown");
  regenerate_notice.classList.add("hide");

  let output = "Error parsing JSON";

  try {
    const tree  = new Permute(JSON.parse(m.editor.act.get_value()));
    const results = tree.permutations;
    output = results.map(result => `<li>${result}</li>`).join("");
    setAllOutput(output);
  } catch(e) {
    setAllOutput(`${output}: ${e}`)
  }
}

generate_all_element.addEventListener("click", permute_all)

const default_button = document.getElementById("default");
default_button.addEventListener("click", () => {
  if (confirm("You will lose anything you've entered, are you sure?")) {
    m.editor.act.set_default_text();
  }
});

const return_github_gist_error = () => {
  k$.status({
    text: "Could not get github gist data",
    type: "status-red"
  })
}

const get_gist_url = () => {
  return new URL(location.href).searchParams.get("gist") || undefined;
}

const sanitize_gist_url = (url) => {
  if (!url) return undefined;
  const regex_1 = /^https\:\/\/gist\.githubusercontent\.com\//;
  const regex_2 = /^https\:\/\/gist\.github\.com\//;
  if (!url.match(regex_1)) {
    if (!!url.match(regex_2)) {
      console.error("URL must start with gist.githubusercontent. Try opening the gist in a new tab and following the redirect first");
      setTimeout(() => {
        k$.status({
          text: "URL must start with gist.githubusercontent. Try opening the gist in a new tab and following the redirect first",
          type: "status-red",
          delay: 3000
        })
      }, 3000);
      return undefined;
    } else {
      return_github_gist_error();
      return undefined;
    }
  }
  else {
    return url
  }
}

const get_gist_data = (url, callback) => {
  k$.status({
    text: "Loading from GitHub gist. Please hold...",
    type: "status-info"
  })
  var request = new XMLHttpRequest();
  request.open('GET', url, true);

  request.onload = function() {
    if (this.status >= 200 && this.status < 400) {
      // Success!
      callback(this.response);
    } else {
      return_github_gist_error();
      return undefined;
    }
  };

  request.onerror = function() {
    // There was a connection error of some sort
    return_github_gist_error();
    return undefined;
  };

  request.send();
}

// Set initial load
const gist_url      = get_gist_url();
const sanitized_gist_url = sanitize_gist_url(gist_url);

if (sanitized_gist_url) {
  get_gist_data(sanitized_gist_url, (data) => {
    const skip_confirm = true;
    if (skip_confirm || confirm("Confirmation needed\n\nThis URL is trying to load JSON data from a GitHub gist. Before this is loaded, please confirm if you trust this source to prevent an XSS attack.")) {
      m.editor.act.set_value({ value: data });
    }
    else {
      m.persistence.act.set_initial_state();
    }
  });
}
else {
  m.persistence.act.set_initial_state();
}