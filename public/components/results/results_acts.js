m.results.acts({
  set_five_sample_results(_$, args) {
    _$("#output-random").innerHTML = args.text;

    k$.status({
        text: "Permutations generated", type: "status-green"
    });
  }
});